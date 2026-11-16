// Signed option flow: which way did the money in a flagged option trade lean?
//
// The hourly unusual-flow scanner (scripts/scan-unusual.mjs) flags contracts
// whose volume jumped and ran past open interest. Volume alone has no side: a
// big call print can be a buyer betting on a rise or a seller writing calls
// against stock. This module turns each flagged print into a signed read:
//
//   1. Tag where the last print sat against the quote (tapeTag): at or past
//      the ask = a buyer paid up, at or past the bid = a seller hit the bid.
//      Compared in whole cents, so on a 1-cent-wide market a print at the
//      bid is never read as "ask" (the old 1-cent margin did exactly that).
//   2. Drop prints that can't be read (stalePrint): a last trade more than
//      15 minutes older than the scan is an old print set against a fresh
//      quote, so its tag is meaningless.
//   3. Sign it: call bought +1, call sold -1, put bought -1, put sold +1.
//   4. Weight it by delta dollars (contracts x |delta| x 100 x spot), the
//      share-equivalent exposure the trade added, not by contract count.
//   5. Leave out same-day expiries and contracts under $0.10 (lottery tickets
//      and hedges dominate them).
//   6. The next morning's settled open interest (scripts/scan-oi.mjs, 08:30
//      ET) says whether the day's volume opened new positions or closed old
//      ones (joinNextDayOi). Opened counts in full, unknown or mixed half,
//      closed a quarter. A print from today is always half until then.
//   7. Age it: a print's weight halves every 3 days over the 7-day log.
//
// signedFlowBySymbol() sums that into a balance in [-1, 1] per stock;
// signedFlowVote() turns it into the grade's Unusual flow vote (+1 from
// +0.30, -1 from -0.40: put buying is often a holder's hedge, so the bearish
// read needs more). The FLO strategy engine reads the same numbers.
//
// FLOW_SIGNED=0 brings back the older rule (ask-side call vs put counts today,
// side-blind 7-day call/put count) for the grade and FLO; the tag fix and the
// stale check in the scanner stay on either way (they are bug fixes).
// legacyFlowVote()/legacyPersistBySymbol() keep that older rule so it can be
// logged beside the new one (shadow keys ufo / ufn / ufb).
//
// Pure functions only: no fetch, no AI, no clock reads beyond the nowMs passed
// in. Imported by the scanner and the bake.

import { greeks, yearsToExpiry } from "./greeks.mjs";

export const FLOW_DIRECTION_VERSION = 1;
export const STALE_PRINT_MS = 15 * 60 * 1000;
export const MIN_PRINT_PRICE = 0.10;
export const MIN_PRINT_DTE = 1;
export const FLOW_WINDOW_MS = 7 * 86400000;
export const FLOW_HALF_LIFE_DAYS = 3;
export const CONFIRM_WEIGHT = Object.freeze({ opened: 1, mixed: 0.5, pending: 0.5, closed: 0.25 });
// ΔOI at or above this share of the day's flagged-contract volume = opened.
export const OPENED_MIN_SHARE = 0.25;
export const VOTE_BULL = 0.3;
export const VOTE_BEAR = -0.4;
export const VOTE_MIN_CONTRACTS = 3;
export const VOTE_MIN_USD = 1_000_000;
// A next-morning OI snapshot where at least this share of contracts carries
// exactly the prior day's OI has not been updated by the provider yet.
const OI_UNCHANGED_MAX_SHARE = 0.9;
// The first OI snapshot after the flag day must land within this many days.
const OI_JOIN_MAX_DAYS = 4;

export function flowSignedEnabled(env = process.env) {
  return String(env?.FLOW_SIGNED ?? "").trim() !== "0";
}

const num = (v) => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const cents = (v) => Math.round(Number(v) * 100);
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;

// Where did the last print sit against the quote? "ask" = at or above the
// offer, "bid" = at or below the bid, "abv"/"blw" = above/below the midpoint,
// "mid" = within 5% of the spread of the midpoint. null when a quote is
// missing or the market is crossed/locked.
export function tapeTag(bid, ask, last) {
  const b = num(bid), a = num(ask), l = num(last);
  if (b == null || a == null || l == null) return null;
  const bc = cents(b), ac = cents(a), lc = cents(l);
  if (!(ac > bc) || bc < 0) return null;
  if (lc >= ac) return "ask";
  if (lc <= bc) return "bid";
  const spread = ac - bc;
  const mid2 = ac + bc; // twice the midpoint, in cents
  const off2 = 2 * lc - mid2; // twice the distance from the midpoint
  if (Math.abs(off2) <= spread * 0.1) return "mid";
  return off2 > 0 ? "abv" : "blw";
}

// Buyer- or seller-initiated, from the tag. Midpoint prints have no side.
export function printSide(tape) {
  if (tape === "ask" || tape === "abv") return "buy";
  if (tape === "bid" || tape === "blw") return "sell";
  return null;
}

// +1 bullish for the stock, -1 bearish, 0 unreadable.
export function flowSign(optionSide, tape) {
  const s = printSide(tape);
  if (!s || (optionSide !== "call" && optionSide !== "put")) return 0;
  const bought = s === "buy" ? 1 : -1;
  return optionSide === "call" ? bought : -bought;
}

function toMs(v) {
  if (v == null || v === "") return null;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.getTime() : null;
  if (typeof v === "number") return Number.isFinite(v) ? (v < 1e12 ? v * 1000 : v) : null;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
}
export { toMs as lastTradeMs };

const ET_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
});
function etParts(ms) {
  const o = {};
  for (const p of ET_PARTS.formatToParts(new Date(ms))) o[p.type] = p.value;
  return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour };
}
// 16:00 ET on the ET calendar day of nowMs, as epoch ms.
let closeMemo = { day: null, ms: null };
export function etCloseMs(nowMs) {
  const day = Math.floor(nowMs / 3600000); // the scanner asks once per contract with one nowMs
  if (closeMemo.day === day) return closeMemo.ms;
  const ms = etCloseCompute(nowMs);
  closeMemo = { day, ms };
  return ms;
}
function etCloseCompute(nowMs) {
  const p = etParts(nowMs);
  for (const offset of [4, 5]) {
    const guess = Date.UTC(p.y, p.m - 1, p.d, 16 + offset);
    const q = etParts(guess);
    if (q.d === p.d && q.h === 16) return guess;
  }
  return Date.UTC(p.y, p.m - 1, p.d, 21);
}

// True when the last trade is too old to be read against the current quote.
// Measured to the scan time, or to 16:00 ET for a scan after the close (the
// final prints of the day stay readable on the 16:00 scan). A missing trade
// time is not called stale: the scanner keeps the tag and says so.
export function stalePrint(lastTrade, nowMs) {
  const t = toMs(lastTrade);
  if (t == null || !Number.isFinite(nowMs)) return false;
  const ref = Math.min(nowMs, etCloseMs(nowMs));
  return ref - t > STALE_PRINT_MS;
}

// Black-Scholes delta from the contract's own IV. null on junk IV.
export function contractDelta(optionSide, spot, strike, expSec, iv, nowMs) {
  const S = num(spot), K = num(strike), sigma = num(iv), e = num(expSec);
  if (!(S > 0 && K > 0 && e > 0) || sigma == null || sigma < 0.01 || sigma > 5) return null;
  const g = greeks(optionSide === "put" ? "put" : "call", S, K, yearsToExpiry(e, nowMs / 1000), sigma);
  return g && Number.isFinite(g.delta) ? r3(g.delta) : null;
}

// Can this logged print vote? Needs a readable side, a delta, a positive
// hourly volume, at least one day to expiry and a price of $0.10 or more.
export function eligiblePrint(e) {
  if (!e || (e.side !== "call" && e.side !== "put")) return false;
  if (!printSide(e.tape) || e.tapeStale) return false;
  const dte = num(e.dte), last = num(e.last), dv = num(e.deltaVol), dl = num(e.delta), spot = num(e.spot);
  return dte != null && dte >= MIN_PRINT_DTE && last != null && last >= MIN_PRINT_PRICE &&
    dv != null && dv > 0 && dl != null && dl !== 0 && spot > 0;
}

// Delta dollars the print added: contracts x |delta| x 100 shares x spot.
export function printWeightUsd(e) {
  return Math.abs(num(e.deltaVol) || 0) * Math.abs(num(e.delta) || 0) * 100 * (num(e.spot) || 0);
}

// Did the day's volume open positions? dOi = next-morning OI - OI at flag time.
export function oiConfirmation(dOi, dayVol) {
  const d = num(dOi), v = num(dayVol);
  if (d == null) return null;
  if (d < 0) return "closed";
  if (v > 0 && d >= OPENED_MIN_SHARE * v) return "opened";
  return "mixed";
}

const ET_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
export const etDate = (iso) => {
  const t = toMs(iso);
  return t == null ? null : ET_DATE.format(new Date(t));
};
const dayGap = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const contractKey = (e) => `${e.symbol}|${e.side}|${e.strike}|${e.expSec}`;

// Settled-OI snapshots by ET date, each with a lookup and an "updated" flag
// (false when the provider had not rolled OI forward from the prior date).
function oiSnapshotsByDate(oiHistory) {
  const snaps = (Array.isArray(oiHistory?.snapshots) ? oiHistory.snapshots : [])
    .filter((s) => s && s.etDate && Array.isArray(s.contracts))
    .sort((a, b) => String(a.etDate).localeCompare(String(b.etDate)) || String(a.scannedAt).localeCompare(String(b.scannedAt)));
  // One per date: prefer the pre-market (settled) scan, else the earliest.
  const byDate = new Map();
  for (const s of snaps) {
    const cur = byDate.get(s.etDate);
    if (!cur || (cur.scanType !== "premarket" && s.scanType === "premarket")) byDate.set(s.etDate, s);
  }
  const dates = [...byDate.keys()].sort();
  const out = [];
  let prevMap = null;
  for (const d of dates) {
    const s = byDate.get(d);
    const map = new Map();
    for (const c of s.contracts) if (c && c.symbol && c.strike != null && c.expSec != null) map.set(contractKey(c), num(c.oi));
    let updated = true;
    if (prevMap) {
      let same = 0, both = 0;
      for (const [k, oi] of map) {
        if (!prevMap.has(k) || oi == null) continue;
        both++;
        if (prevMap.get(k) === oi) same++;
      }
      if (both >= 50 && same / both >= OI_UNCHANGED_MAX_SHARE) updated = false;
    }
    out.push({ date: d, map, updated });
    prevMap = map;
  }
  return out;
}

// Stamp each logged print with the next trading morning's open interest:
// oiNext, oiChg (vs the OI shown when it flagged) and oiRead (opened / mixed /
// closed). All prints of one contract on one day share the day's volume.
// Mutates and returns the number of prints stamped this call.
export function joinNextDayOi(entries, oiHistory) {
  const snaps = oiSnapshotsByDate(oiHistory);
  if (!snaps.length || !Array.isArray(entries)) return 0;
  const groups = new Map();
  for (const e of entries) {
    if (!e || e.oiRead || num(e.oi) == null) continue;
    const d = etDate(e.scannedAt);
    if (!d) continue;
    const k = `${contractKey(e)}|${d}`;
    if (!groups.has(k)) groups.set(k, { date: d, key: contractKey(e), list: [] });
    groups.get(k).list.push(e);
  }
  let stamped = 0;
  for (const g of groups.values()) {
    const snap = snaps.find((s) => s.date > g.date);
    if (!snap || !snap.updated || dayGap(g.date, snap.date) > OI_JOIN_MAX_DAYS) continue;
    const next = snap.map.get(g.key);
    if (next == null) continue;
    // The OI on screen during the flag day is the prior session's settled OI.
    const before = Math.min(...g.list.map((e) => num(e.oi)).filter((v) => v != null));
    const dayVol = Math.max(...g.list.map((e) => num(e.vol) || 0));
    const chg = next - before;
    const read = oiConfirmation(chg, dayVol);
    for (const e of g.list) {
      e.oiNext = next; e.oiChg = chg; e.oiRead = read; e.oiDate = snap.date;
      stamped++;
    }
  }
  return stamped;
}

function ageWeight(ageMs) {
  return Math.pow(0.5, Math.max(0, ageMs) / 86400000 / FLOW_HALF_LIFE_DAYS);
}

// The signed read per stock over the 7-day log. Each value:
//   balance  (bull - bear) / (bull + bear) in weighted delta dollars, [-1, 1]
//   bullUsd / bearUsd  weighted delta dollars on each side
//   n / contracts       eligible prints / distinct contracts
//   opened / closed / pending  prints by next-morning OI read
//   today { bullUsd, bearUsd, bullPrem, bearPrem, nBull, nBear }  this ET
//         day's prints, unweighted by age or confirmation (FLO reads it)
export function signedFlowBySymbol(flowLog, nowMs = Date.now()) {
  const entries = Array.isArray(flowLog?.entries) ? flowLog.entries : Array.isArray(flowLog) ? flowLog : [];
  const cutoff = nowMs - FLOW_WINDOW_MS;
  const today = ET_DATE.format(new Date(nowMs));
  const by = {};
  for (const e of entries) {
    const t = toMs(e?.scannedAt);
    if (t == null || t < cutoff || t > nowMs + 60000 || !eligiblePrint(e)) continue;
    const sign = flowSign(e.side, e.tape);
    if (!sign) continue;
    const s = (by[e.symbol] ||= { bullUsd: 0, bearUsd: 0, n: 0, keys: new Set(), opened: 0, closed: 0, mixed: 0, pending: 0,
      today: { bullUsd: 0, bearUsd: 0, bullPrem: 0, bearPrem: 0, nBull: 0, nBear: 0 } });
    const usd = printWeightUsd(e);
    const conf = e.oiRead && CONFIRM_WEIGHT[e.oiRead] != null ? e.oiRead : "pending";
    const w = usd * CONFIRM_WEIGHT[conf] * ageWeight(nowMs - t);
    if (sign > 0) s.bullUsd += w; else s.bearUsd += w;
    s.n++; s.keys.add(contractKey(e)); s[conf]++;
    if (ET_DATE.format(new Date(t)) === today) {
      const prem = Math.abs(num(e.deltaVol) || 0) * (num(e.last) || 0) * 100;
      if (sign > 0) { s.today.bullUsd += usd; s.today.bullPrem += prem; s.today.nBull++; }
      else { s.today.bearUsd += usd; s.today.bearPrem += prem; s.today.nBear++; }
    }
  }
  const out = {};
  for (const [sym, s] of Object.entries(by)) {
    const gross = s.bullUsd + s.bearUsd;
    out[sym] = {
      balance: gross > 0 ? r2((s.bullUsd - s.bearUsd) / gross) : 0,
      bullUsd: Math.round(s.bullUsd), bearUsd: Math.round(s.bearUsd),
      n: s.n, contracts: s.keys.size, opened: s.opened, closed: s.closed, mixed: s.mixed, pending: s.pending,
      today: {
        bullUsd: Math.round(s.today.bullUsd), bearUsd: Math.round(s.today.bearUsd),
        bullPrem: Math.round(s.today.bullPrem), bearPrem: Math.round(s.today.bearPrem),
        nBull: s.today.nBull, nBear: s.today.nBear,
      },
    };
  }
  return out;
}

const usdShort = (v) => (v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M` : `$${Math.round(v / 1e3)}K`);

// The grade's vote from one stock's signed read. ok = enough evidence to read.
export function signedFlowVote(read) {
  if (!read) return { vote: 0, ok: false, value: null };
  const gross = (read.bullUsd || 0) + (read.bearUsd || 0);
  const ok = read.contracts >= VOTE_MIN_CONTRACTS && gross >= VOTE_MIN_USD;
  const vote = !ok ? 0 : read.balance >= VOTE_BULL ? 1 : read.balance <= VOTE_BEAR ? -1 : 0;
  const bits = [`${read.balance >= 0 ? "+" : ""}${read.balance.toFixed(2)}`, `${usdShort(read.bullUsd)} bull / ${usdShort(read.bearUsd)} bear`];
  bits.push(`${read.contracts} contract${read.contracts === 1 ? "" : "s"}${read.opened ? `, ${read.opened} opened` : ""}`);
  return { vote, ok, value: bits.join(" · ") };
}

// --- The older rule, kept for FLOW_SIGNED=0 and the side-by-side log -------

// Side-blind 7-day count: every flagged call bullish, every put bearish.
export function legacyPersistBySymbol(flowLog, nowMs = Date.now()) {
  const cutoff = nowMs - FLOW_WINDOW_MS;
  const counts = {};
  for (const e of (Array.isArray(flowLog?.entries) ? flowLog.entries : [])) {
    if (!e || !e.symbol || (e.side !== "call" && e.side !== "put")) continue;
    const t = toMs(e.scannedAt);
    if (t == null || t < cutoff) continue;
    const c = (counts[e.symbol] ||= { bull: 0, bear: 0 });
    if (e.side === "call") c.bull += 1; else c.bear += 1;
  }
  const out = {};
  for (const [s, c] of Object.entries(counts)) {
    const flags = c.bull + c.bear;
    if (flags < 5) continue;
    out[s] = { balance: r2((c.bull - c.bear) / flags), bull: c.bull, bear: c.bear, flags };
  }
  return out;
}

// Ask-side call vs put counts today (5+ prints), else the side-blind balance.
export function legacyFlowVote(contracts, persistBalance) {
  const tape = Array.isArray(contracts)
    ? contracts.filter((c) => c && c.flagged !== false && (c.tape === "ask" || c.tape === "abv"))
    : null;
  const bull = tape ? tape.filter((c) => c.side === "call").length : null;
  const bear = tape ? tape.filter((c) => c.side === "put").length : null;
  if (bull != null && bear != null && bull + bear >= 5) {
    const ratio = (bull + 1) / (bear + 1);
    return { vote: ratio >= 1.5 ? 1 : ratio <= 0.5 ? -1 : 0, ok: true, value: `${bull}B/${bear}S ask` };
  }
  const p = num(persistBalance);
  if (p != null && Math.abs(p) >= 0.3) return { vote: p > 0 ? 1 : -1, ok: true, value: `persist ${r2(p)}` };
  return { vote: 0, ok: false, value: null };
}

// Both votes for every stock with flow, for the shadow log.
export function flowVotesBySymbol(unusualPayload, flowLog, nowMs = Date.now()) {
  const signed = signedFlowBySymbol(flowLog, nowMs);
  const legacyPersist = legacyPersistBySymbol(flowLog, nowMs);
  const rows = new Map((Array.isArray(unusualPayload?.tickers) ? unusualPayload.tickers : []).map((t) => [t?.symbol, t]));
  const syms = new Set([...Object.keys(signed), ...Object.keys(legacyPersist), ...[...rows.keys()].filter(Boolean)]);
  const out = {};
  for (const s of syms) {
    const legacy = legacyFlowVote(rows.get(s)?.contracts || null, legacyPersist[s]?.balance);
    const now = signedFlowVote(signed[s] || null);
    out[s] = { ufo: legacy.ok ? legacy.vote : null, ufn: now.ok ? now.vote : null, ufb: signed[s] ? signed[s].balance : null };
  }
  return out;
}

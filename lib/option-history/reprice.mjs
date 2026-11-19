// Re-price the engines' history-test option trades with real quotes
// (2026-11-19, owner request; the follow-up to the 2026-11-19 finding that
// the engines' option edge fails on real implied volatility).
//
// The history test (lib/engines/backtest.mjs) prices every option with
// Black-Scholes on a modeled implied volatility. Here each of its closed
// option trades from 2019 on is matched to the real listed contract nearest
// to the one it modeled (same right, nearest expiry within EXPIRY_GAP_DAYS,
// nearest strike within STRIKE_GAP_PCT) and priced from real end-of-day
// quotes (lib/option-history, DoltHub rows):
//   entry  the real ask on the entry date (or the nearest quote day within
//          QUOTE_GAP_DAYS, before or after)
//   same   exit at the real bid on the modeled trade's own exit date (or the
//          last quote day before it): the same holding window, real prices
//   path   walk the real mids after entry: the setup's take-profit or stop
//          (measured against the real entry ask) closes at that day's bid;
//          otherwise the modeled exit date's bid, as above
// Results are aggregates only (counts, averages, medians, win rates per
// engine and setup, both halves of the period); no trade row and no price
// leaves this module.

export const EXPIRY_GAP_DAYS = 10;
export const STRIKE_GAP_PCT = 5;
export const QUOTE_GAP_DAYS = 3;
export const EXIT_GAP_DAYS = 5;

const DAY = 86400000;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const dms = (d) => Date.parse(`${d}T00:00:00Z`);
const fin = (x) => typeof x === "number" && Number.isFinite(x);
const r1 = (x) => (fin(x) ? Math.round(x * 10) / 10 : null);
const r2 = (x) => (fin(x) ? Math.round(x * 100) / 100 : null);
const mid = (q) => (fin(q?.bid) && fin(q?.ask) && q.ask >= q.bid ? (q.bid + q.ask) / 2 : null);

export function expiryIso(expiry) {
  if (fin(expiry)) return iso(expiry * 1000);
  return /^\d{4}-\d{2}-\d{2}/.test(String(expiry || "")) ? String(expiry).slice(0, 10) : null;
}

// The real contract nearest to the modeled one, from one day's rows.
export function matchContract(rows, { right, expiry, strike }, { expiryGapDays = EXPIRY_GAP_DAYS, strikeGapPct = STRIKE_GAP_PCT } = {}) {
  const want = dms(expiry);
  let best = null, bestKey = null;
  for (const r of rows || []) {
    if (r.right !== right || !(r.strike > 0) || !(r.ask > 0)) continue;
    const eg = Math.abs(dms(r.expiry) - want) / DAY;
    if (eg > expiryGapDays) continue;
    const sg = Math.abs(r.strike - strike) / strike * 100;
    if (sg > strikeGapPct) continue;
    const key = [eg, sg];
    if (!best || key[0] < bestKey[0] || (key[0] === bestKey[0] && key[1] < bestKey[1])) { best = r; bestKey = key; }
  }
  return best;
}

// Quote days for an underlying near a date: the date itself, then the
// nearest within `gap` days (earlier first on a tie).
function nearDays(date, gap, dir = "both") {
  const out = [date];
  for (let k = 1; k <= gap; k++) {
    if (dir !== "after") out.push(iso(dms(date) - k * DAY));
    if (dir !== "before") out.push(iso(dms(date) + k * DAY));
  }
  return out;
}

// Re-price one trade row (scripts/engines-backtest.mjs --trades-out shape).
// reader: lib/option-history historyReader. exits: { tp, stop } in percent.
// Returns { ok: true, ... } or { ok: false, skip: reason }.
export function repriceTrade(t, reader, exits = {}, opts = {}) {
  const right = t.optionType === "put" ? "P" : t.optionType === "call" ? "C" : null;
  const expiry = expiryIso(t.expiry);
  if (!right || !expiry || !(t.strike > 0) || !t.entryDate || !t.exitDate) return { ok: false, skip: "incomplete trade" };
  let entryRow = null, entryDay = null, sawQuotes = false;
  for (const d of nearDays(t.entryDate, opts.quoteGapDays ?? QUOTE_GAP_DAYS)) {
    const rows = reader.rowsOn(t.symbol, d);
    if (!rows.length) continue;
    sawQuotes = true;
    const m = matchContract(rows, { right, expiry, strike: t.strike }, opts);
    if (m) { entryRow = m; entryDay = d; break; }
  }
  if (!entryRow) return { ok: false, skip: sawQuotes ? "no matching contract" : "no quotes near entry" };
  const entryAsk = entryRow.ask;
  const quoteOn = (d) => reader.rowsOn(t.symbol, d).find((r) => r.symbol === entryRow.symbol) || null;
  // The exit date's bid, or the last quote day before it.
  const exitCap = t.exitDate < entryRow.expiry ? t.exitDate : entryRow.expiry;
  let exitQ = null, exitDay = null;
  for (const d of nearDays(exitCap, opts.exitGapDays ?? EXIT_GAP_DAYS, "before")) {
    if (d <= entryDay) break;
    const q = quoteOn(d);
    if (q && fin(q.bid)) { exitQ = q; exitDay = d; break; }
  }
  if (!exitQ) return { ok: false, skip: "no quote at exit" };
  const same = (exitQ.bid / entryAsk - 1) * 100;
  // The path: real mids against the real entry ask.
  let pathPct = same, pathReason = "modeled exit date", pathDay = exitDay;
  const tp = fin(exits.tp) ? exits.tp : null, stop = fin(exits.stop) ? exits.stop : null;
  if (tp != null || stop != null) {
    const days = reader.datesFor(t.symbol, iso(dms(entryDay) + DAY), exitDay);
    for (const d of days) {
      const q = quoteOn(d);
      const m = mid(q);
      if (m == null) continue;
      const pnl = (m / entryAsk - 1) * 100;
      if ((tp != null && pnl >= tp) || (stop != null && pnl <= stop)) {
        pathPct = (q.bid / entryAsk - 1) * 100; pathReason = pnl >= (tp ?? Infinity) ? "take-profit" : "stop"; pathDay = d;
        break;
      }
    }
  }
  return {
    ok: true, engine: t.engine, setup: t.setup || "none", side: t.side, entryDay, exitDay, pathDay, pathReason,
    modeledPct: fin(t.pnlPct) ? t.pnlPct : null, samePct: same, pathPct,
    entrySpreadPct: fin(entryRow.bid) && entryRow.ask > 0 ? (entryRow.ask - entryRow.bid) / ((entryRow.ask + entryRow.bid) / 2) * 100 : null,
    modeledEntry: fin(t.entryMid) ? t.entryMid : null, realEntry: entryAsk,
  };
}

function stats(list, key) {
  const xs = list.map((x) => x[key]).filter(fin).sort((a, b) => a - b);
  if (!xs.length) return null;
  const n = xs.length, avg = xs.reduce((s, x) => s + x, 0) / n;
  const median = n % 2 ? xs[(n - 1) / 2] : (xs[n / 2 - 1] + xs[n / 2]) / 2;
  const sd = n > 1 ? Math.sqrt(xs.reduce((s, x) => s + (x - avg) ** 2, 0) / (n - 1)) : null;
  return { n, avg: r1(avg), median: r1(median), win: r2(xs.filter((x) => x > 0).length / n), t: sd ? r2(avg / (sd / Math.sqrt(n))) : null };
}

// Aggregate re-priced trades. `skips`: { reason: count }. Each group reports
// the modeled, same-window and real-path averages (percent of the premium
// paid per trade), plus the dollar read at $2,000 of premium a trade, and the
// real-path read split into two halves by entry date.
export function summarizeReprice(priced, skips = {}, { usdPerTrade = 2000 } = {}) {
  const group = (list) => {
    if (!list.length) return null;
    const sorted = list.slice().sort((a, b) => (a.entryDay < b.entryDay ? -1 : 1));
    const cut = Math.floor(sorted.length / 2);
    const modeled = stats(list, "modeledPct"), same = stats(list, "samePct"), pathS = stats(list, "pathPct");
    return {
      n: list.length, from: sorted[0].entryDay, to: sorted[sorted.length - 1].entryDay,
      modeled, sameWindow: same, realPath: pathS,
      usd: { modeled: modeled ? Math.round(modeled.avg / 100 * usdPerTrade * modeled.n) : null, realPath: pathS ? Math.round(pathS.avg / 100 * usdPerTrade * pathS.n) : null },
      halves: [stats(sorted.slice(0, cut), "pathPct"), stats(sorted.slice(cut), "pathPct")],
      entrySpreadMedianPct: stats(list, "entrySpreadPct")?.median ?? null,
      pathExits: list.reduce((o, x) => ((o[x.pathReason] = (o[x.pathReason] || 0) + 1), o), {}),
    };
  };
  const byEngine = {}, bySetup = {};
  for (const p of priced) {
    (byEngine[p.engine] ||= []).push(p);
    (bySetup[`${p.engine}/${p.setup}/${p.side}`] ||= []).push(p);
  }
  return {
    priced: priced.length, skipped: Object.values(skips).reduce((s, x) => s + x, 0), skips,
    all: group(priced),
    engines: Object.fromEntries(Object.entries(byEngine).map(([k, v]) => [k, group(v)])),
    setups: Object.fromEntries(Object.entries(bySetup).filter(([, v]) => v.length >= 5).map(([k, v]) => [k, group(v)])),
    notes: [
      "Entry at the real ask, exit at the real bid; modeled = the history test's own percent per trade (modeled implied volatility, 3.5 points of costs).",
      "Percent of the premium paid per trade; dollars at $2,000 of premium a trade, before sizing.",
      "Setups with fewer than 5 priced trades are left out of the setup table.",
    ],
  };
}

// Synthetic strategy-engine files for the browser check and screenshots
// (scripts/engines-browser.mjs). Made-up prices walked through the real
// engine code (lib/engines/index.mjs runEngines), twice a session, so the
// page file has real candidates, open and closed trades, shadow trades, a
// same-contract label against a Top Picks trade and the committed history
// test. Nothing here is market data, and nothing contacts a provider, an
// account or the store.
import { fileURLToPath } from "node:url";
import { MACRO_ETFS, ENGINES, engineName, isSharesTrade } from "../lib/engines/config.mjs";
import { clientOrderId, orderIdPrefix } from "../lib/webull-mirror.mjs";
import { emptyRecord, emptyState } from "../lib/engines/book.mjs";
import { runEngines, loadEnginesResearch } from "../lib/engines/index.mjs";
import { sessionForDate, etClock } from "../lib/us-equity-calendar.mjs";
import { pickTradeId } from "../lib/pick-trade-text.mjs";
import { bsPrice } from "../lib/greeks.mjs";

// The UTC instant of an ET wall-clock time on a date (daylight time or not).
function etIso(day, hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  for (const off of [4, 5]) {
    const iso = `${day}T${String(h + off).padStart(2, "0")}:${String(m).padStart(2, "0")}:00.000Z`;
    const c = etClock(Date.parse(iso));
    if (c.date === day && c.minute === h * 60 + m) return iso;
  }
  throw new Error(`no ET time for ${day} ${hhmm}`);
}

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const NAMES = ["NVDA", "AMD", "AAPL", "MSFT", "AMZN", "META", "TSLA", "AVGO", "MU", "ORCL", "CRM", "NFLX", "COST", "JPM", "XOM", "LLY", "UNH", "CAT", "BA", "DIS", "UBER", "PLTR", "SHOP", "INTC"];

function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function weekdays(endDate, n) {
  const out = []; const d = new Date(endDate + "T12:00:00Z");
  while (out.length < n) { if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.unshift(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() - 1); }
  return out;
}
function walk(dates, { seed, start = 100, drift = 0.0004, vol = 0.015 }) {
  const r = rng(seed); let c = start; const bars = [];
  for (const t of dates) {
    const z = (r() + r() + r() + r() - 2) * 1.7, o = c * (1 + (r() - 0.5) * vol * 0.6);
    c = Math.max(1, c * (1 + drift + z * vol));
    const h = Math.max(o, c) * (1 + r() * vol * 0.5), l = Math.min(o, c) * (1 - r() * vol * 0.5);
    bars.push({ t, o, h, l, c, v: Math.round(1e6 * (0.6 + r() * 1.2)) });
  }
  return bars;
}
function chainFor(spot, nowMs, iv) {
  const chains = {};
  for (const dte of [9, 16, 23, 30, 37, 44, 58, 72, 100, 128, 156, 191]) {
    // Expirations land on fixed calendar days so a contract keeps its key from run to run.
    const exp = Math.floor((Math.floor(nowMs / (7 * 86400000)) * 7 * 86400000 + dte * 86400000) / 1000);
    const days = (exp * 1000 - nowMs) / 86400000;
    if (days < 2) continue;
    const c = [], p = [];
    for (let k = 0.7; k <= 1.3001; k += 0.025) {
      const K = Math.round(spot * k * 2) / 2;
      for (const [type, col] of [["call", c], ["put", p]]) {
        const px = bsPrice(type, spot, K, days / 365, iv, 0.045);
        if (!(px > 0.05)) continue;
        col.push({ s: K, b: +(px * 0.97).toFixed(2), a: +(px * 1.03).toFixed(2), l: +px.toFixed(2), iv, oi: 800, v: 60 });
      }
    }
    chains[exp] = { c, p };
  }
  return chains;
}

// { view, record, state, mirror, flagship } after `sessions` trading days of
// runs ending on `end` (an ET date). `sessions` 0 gives the first-morning view.
export async function enginesFixture({ end = "2026-11-13", sessions = 70 } = {}) {
  const stepDays = weekdays(end, Math.max(1, sessions) + 20).filter((d) => sessionForDate(d)?.open !== false && sessionForDate(d)).slice(-Math.max(1, sessions));
  const DATES = weekdays(end, 620);
  const SERIES = {};
  let seed = 400;
  for (const s of MACRO_ETFS) SERIES[s] = walk(DATES, { seed: seed++, start: 100 + seed % 90, drift: 0.0003, vol: 0.011 });
  NAMES.forEach((s, i) => { SERIES[s] = walk(DATES, { seed: seed++, start: 40 + i * 9, drift: ((i % 5) - 1.5) * 0.0004, vol: 0.014 + (i % 4) * 0.004 }); });
  const research = await loadEnginesResearch(ROOT);

  const input = (nowIso, late, flagshipOpen) => {
    const ms = Date.parse(nowIso), today = nowIso.slice(0, 10);
    const chains = {};
    for (const [sym, bars] of Object.entries(SERIES)) {
      const conf = bars.filter((b) => b.t < today), bar = bars.find((b) => b.t === today) || conf.at(-1);
      const spot = late ? bar.c : bar.o;
      const iv = 0.26 + (sym.charCodeAt(0) % 6) * 0.03;
      chains[sym] = {
        spot, marketState: "REGULAR", chains: chainFor(spot, ms, iv),
        _patternBars: [...conf, { t: today, o: bar.o, h: Math.max(bar.o, spot), l: Math.min(bar.o, spot), c: spot, v: Math.round(bar.v * (late ? 0.9 : 0.25)) }],
        ivRank: { pctile: 30 + (sym.charCodeAt(1) % 50), iv }, technicals: { volRegime: { rv30: iv * 0.85 }, volume: { rvol: 1.1 } },
        fundamentals: MACRO_ETFS.includes(sym) ? null : { forwardPE: 18 + (sym.charCodeAt(2) % 9), operatingMargin: 14 + (sym.charCodeAt(0) % 20), returnOnEquity: 12 + (sym.charCodeAt(1) % 25), revenueGrowthYoy: (sym.charCodeAt(2) % 30) - 6, marketCap: 5e10, freeCashFlow: 2e9, debtToEquity: 40 + (sym.charCodeAt(0) % 90), shortPercentOfFloat: 2 + (sym.charCodeAt(1) % 16) },
      };
    }
    const earningsStore = { tickers: {} };
    NAMES.forEach((sym, i) => {
      const events = [];
      for (let q = 9; q >= 0; q--) {
        const d = DATES[DATES.length - 6 - (i % 20) * 3 - q * 63];
        if (d) events.push({ date: d, session: q % 2 ? "AM" : "PM", epsActual: 1 + (10 - q) * 0.15 * (i % 4 === 3 ? -0.4 : 1), epsEstimate: 1 + (10 - q) * (i % 3 === 0 ? 0.11 : 0.15) });
      }
      earningsStore.tickers[sym] = { events };
    });
    const fredDates = weekdays(today, 460);
    return {
      builtAtIso: nowIso, chains, tickers: [...NAMES, "SPY", "QQQ"], isEtf: (s) => MACRO_ETFS.includes(s), barsOf: (s) => chains[s]?._patternBars || [],
      earningsStore, groupOf: (s) => (MACRO_ETFS.includes(s) ? "ETF" : `Group ${NAMES.indexOf(s) % 3}`),
      unusual: { tickers: [{ symbol: "PLTR", contracts: Array.from({ length: 7 }, () => ({ side: "call", tape: "ask", flagged: true, premium: 240000 })) }] },
      crowdRollup: [{ symbol: "PLTR", shortZ20: 1.8, borrowFeePct: 9 }],
      fred: {
        DGS10: fredDates.map((t, i) => ({ t, v: 4.7 - i * 0.0016 })), DGS2: fredDates.map((t) => ({ t, v: 3.9 })), T10Y2Y: fredDates.map((t) => ({ t, v: 0.45 })), DFF: fredDates.map((t) => ({ t, v: 4.1 })),
        NFCI: fredDates.filter((_, i) => i % 5 === 0).map((t, i) => ({ t, v: -0.35 + Math.sin(i / 9) * 0.25 })), DTWEXBGS: fredDates.map((t, i) => ({ t, v: 121 - i * 0.004 })),
        CPIAUCSL: [{ t: "2025-08-01", v: 300 }, { t: "2025-09-01", v: 300.6 }, { t: "2026-08-01", v: 308.4 }, { t: "2026-09-01", v: 309 }], UNRATE: [{ t: "2026-09-01", v: 4.3 }], USREC: [{ t: "2026-09-01", v: 0 }],
      },
      vix: fredDates.map((t, i) => ({ t, v: 17 + Math.sin(i / 11) * 4 })), vix3m: fredDates.map((t) => ({ t, v: 19 })),
      macroEvents: [{ date: stepDays.at(-2) || end, kind: "cpi" }, { date: stepDays.at(-12) || end, kind: "fomc" }],
      regime: { cell: "up-calm", era: "normal" }, labelRows: DATES.map((date, i) => ({ date, cell: ["up-calm", "chop-calm", "up-calm", "down-stressed"][Math.floor(i / 60) % 4], era: "normal" })), macroState: "neutral",
      flagshipOpen: flagshipOpen || [], flagshipStats: { id: "flagship", name: "Top Picks", open: 2, n: 46, winRate: 0.63, avg: 3.4 }, env: {}, research,
    };
  };

  // Two passes over the same walk: the first finds an engine trade that is
  // still open at the end; the second hands its contract to Top Picks one run
  // before the engine opens it, so the label is made by the real code.
  const walkRuns = (plant) => {
    let loaded = { record: emptyRecord(), state: emptyState() }, res = null, flag = null;
    for (const day of stepDays) {
      const half = sessionForDate(day)?.closeMinute < 960;
      for (const [hhmm, late] of half ? [["11:00", false]] : [["11:00", false], ["15:30", true]]) {
        const nowIso = etIso(day, hhmm);
        if (plant && !flag && nowIso === plant.openedIso) flag = { symbol: plant.symbol, side: plant.side, entryDate: plant.priorIso, contract: { ...plant.contract } };
        // The once-a-day recent replay is slow; only the last day's is shown.
        if (day !== stepDays.at(-1)) loaded.state.replay = { date: day, skipped: "fixture" };
        res = runEngines({ loaded, ...input(nowIso, late, flag ? [flag] : []) });
        loaded = { record: res.record, state: res.state };
      }
    }
    return { ...res, flag };
  };
  const first = walkRuns(null);
  // An option trade (a share trade has no contract Top Picks could hold).
  const keep = first.record.open.filter((t) => !t.noMirror && !isSharesTrade(t) && t.entryDate.slice(0, 10) !== stepDays[0]).at(-1) || null;
  let out = first, flagship = null;
  if (keep) {
    // Top Picks opened it at the run before: the same morning, or the prior afternoon.
    const day = etClock(Date.parse(keep.entryDate)).date, am = etClock(Date.parse(keep.entryDate)).minute < 13 * 60;
    const priorIso = am ? etIso(stepDays[Math.max(0, stepDays.indexOf(day) - 1)], "15:30") : etIso(day, "11:00");
    out = walkRuns({ symbol: keep.symbol, side: keep.side, contract: keep.contract, openedIso: keep.entryDate, priorIso });
    if (out.flag) {
      const f = out.flag;
      flagship = {
        symbol: f.symbol, side: f.side, score: f.side === "put" ? -8.1 : 8.1, entryRegime: "neutral", tier: f.side === "put" ? "strong-put" : "strong-call", entryDate: f.entryDate, exitDate: null,
        entrySpot: keep.entrySpot, lastSpot: keep.lastSpot ?? keep.entrySpot, status: "open", outcome: null, optionPnlPct: 4.2, sector: "Technology", gradeModelVersion: "2026-11-macro-context", exitPolicy: { version: "2026-10-22-tp25" },
        contract: { structure: "long", optionType: f.contract.optionType, strike: f.contract.strike, expiry: f.contract.expiry, expiryLabel: new Date(f.contract.expiry * 1000).toISOString().slice(0, 10), iv: f.contract.iv ?? 0.3, delta: f.side === "put" ? -0.55 : 0.55, mid: f.contract.mid, netDebit: f.contract.mid },
      };
      flagship.tradeId = pickTradeId(flagship);
    }
  }

  // The paper account as /api/auth/webull-mirror?scope=engines answers it
  // (rows in the shape of ledgerToTestTrades; hand-made, not broker data).
  const leg = (t) => isSharesTrade(t) ? `${t.contract.shares} shares` : `BUY ${new Date(t.contract.expiry * 1000).toISOString().slice(0, 10)} ${t.contract.strike} ${String(t.contract.optionType).toUpperCase()}`;
  const mirrorRow = (t, i, closed) => {
    const shared = !!t.noMirror, missed = !shared && i % 9 === 4;
    // Size asked and filled (2026-11-19): the record's qty (1 to 10) or share
    // count; every 7th filled multi-unit trade is only partly filled.
    const stock = isSharesTrade(t), req = stock ? Math.max(1, t.contract.shares || 1) : Math.min(10, Math.max(1, t.contract.qty || 1));
    const got = shared || missed ? 0 : req > 1 && i % 7 === 2 ? Math.max(1, Math.floor(req / 2)) : req;
    const fill = shared || missed ? null : +(t.contract.mid * (1 + ((i % 5) - 1) * 0.008)).toFixed(2);
    const exit = closed && fill != null ? +((t.exitMid ?? t.contract.mid) * (1 - (i % 3) * 0.01)).toFixed(2) : null;
    return {
      tradeId: t.tradeId, engine: t.engine, symbol: t.symbol, side: t.side, structure: "long", state: shared ? "skipped" : missed ? "missed" : closed ? "closed" : "open",
      sharedContract: shared ? { heldBy: t.shared?.heldBy || "flagship", heldById: t.shared?.heldById || null } : null, sharedWith: null,
      legs: leg(t), engineEntryPrice: t.contract.mid, engineEntryIso: t.entryDate, fillPrice: fill, fillIso: fill != null ? t.entryDate : null, entryDiffPct: fill != null ? +(((fill - t.contract.mid) / t.contract.mid) * 100).toFixed(1) : null,
      engineExitPrice: closed ? t.exitMid ?? null : null, engineExitIso: closed ? t.exitDate : null, engineCloseReason: closed ? t.status : null, enginePnlPct: closed ? t.optionPnlPct : null,
      closeFillPrice: exit, closeFillIso: exit != null ? t.exitDate : null, exitDiffPct: exit != null && t.exitMid > 0 ? +(((exit - t.exitMid) / t.exitMid) * 100).toFixed(1) : null,
      paperPnlPct: exit != null && fill > 0 ? +(((exit - fill) / fill) * 100).toFixed(1) : null, fees: 0.55, needsReview: false,
      labels: shared ? ["Held by Top Picks: not bought twice"] : [], note: shared ? `Same contract is held by Top Picks${t.shared?.heldById ? ` (${t.shared.heldById})` : ""}: recorded on its own track record, not bought twice.` : missed ? "Entry did not fill inside the allowed range." : null,
      madeBy: engineName(t.engine), instrument: stock ? "stock" : "option", requestedQty: shared ? 1 : req, filledQty: got, closedQty: exit != null ? got : 0, openQty: exit != null ? 0 : got,
      qtyBasis: stock ? "shares" : (t.contract.qty || 1) > 10 ? "record-capped" : t.contract.qty ? "record" : "one",
      fillOutcome: shared ? "shared" : missed ? "missed" : got < req ? "partial" : "filled",
      attempts: shared ? [] : [{ phase: "entry", n: 1, orderPrefix: orderIdPrefix(clientOrderId(t.tradeId, "entry", 1, t.engine)) }], decisions: [],
    };
  };
  const rec = out.record;
  // Share trades and core holdings reach the paper account as stock since
  // 2026-11-19 (Owner Settings WEBULL_SHARES on, the default).
  const opt = (list) => list;
  const trades = [...opt(rec.open).map((t, i) => mirrorRow(t, i, false)), ...opt(rec.closed).slice(0, 60).map((t, i) => mirrorRow(t, i + 3, true))];
  const lastRunIso = new Date(Date.parse(out.view.runIso) + 9 * 60000).toISOString();
  const mirror = {
    scope: "engines", enabled: true, enginesMirror: true, goLiveIso: rec.startedIso, lastRunIso, engineSnapshotIso: out.view.runIso,
    health: { status: "saved-checks-current", issues: [], counts: {}, engines: { open: opt(rec.open).length, mirrored: trades.filter((t) => t.state === "open").length, shared: opt(rec.open).filter((t) => t.noMirror).length, unfilled: trades.filter((t) => t.state === "missed" && opt(rec.open).some((o) => o.tradeId === t.tradeId)).length, pending: 0, untracked: 0 } },
    reconciliation: { checkedAtIso: lastRunIso, status: "matched", alerts: [] }, runs: [], rows: [], trades,
    sizing: { shares: true, quantities: true, picksSizing: true, riskUsd: 2000, maxQty: 10 },
  };
  return { view: out.view, record: out.record, state: out.state, mirror, flagship, names: NAMES, engines: Object.keys(ENGINES) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const f = await enginesFixture();
  const v = f.view;
  console.log(JSON.stringify({
    run: v.runIso, open: v.total.open, closed: v.total.n, shared: v.shared.length, flagship: f.flagship?.tradeId || null,
    engines: v.engines.map((e) => ({ id: e.id, open: e.open.length, closed: e.closedTotal, cands: e.candidates.length, shadowOpen: e.shadow.open.length, shadowClosed: e.shadow.stats.n, log: e.learning?.log?.length || 0, bar: e.bar.now, paused: !!e.paused })),
    bytes: JSON.stringify(v).length,
  }, null, 1));
}

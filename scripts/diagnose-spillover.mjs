// scripts/diagnose-spillover.mjs
//
// READ-ONLY Phase-1 backtest for the Event Spillover Matrix (docs/event-spillover.md).
// Answers: is same-sector earnings read-through real, significant, directionally
// consistent, and bigger than what the follower's options price? It validates the
// correlation structure — it does NOT suggest trades (owner directive in the doc).
//
// Pilot universe (doc §3): drivers = followers = the five tracked banks
// (JPM, BAC, C, GS, MS); sector ETF = XLF (or KBE via --etf=KBE), fetched
// price-only. WFC/USB/PNC/TFC + other large financials are contamination
// sources only, never followers.
//
// Data (all crumb-free, so it runs on machines where Yahoo's cookie/crumb
// handshake fails — only the optional live-IV column wants the crumb):
//   - 5y daily bars: Yahoo chart() (unauthenticated, verified to serve ~5.2y).
//   - Driver event dates: Nasdaq's per-date earnings calendar walked backwards
//     over the Jan/Apr/Jul/Oct reporting windows (verified to serve past dates;
//     historical rows omit the session, so the pilot banks — all well-known
//     BMO reporters, same set as build.mjs's EARNINGS_BMO_REPORTERS — are
//     stamped AM). Results are cached under os.tmpdir() so re-runs are cheap.
//     data/earnings-history.json enriches/overrides when hydrated.
//   - Follower priced move (ATM ~30d IV): Yahoo options() → CBOE delayed-quotes
//     JSON → data/iv-history/<SYM>.json, first that works; column reads n/a
//     when none do.
//
// Method (doc §5–§10):
//   Engine A  — sector-routed: rolling OLS beta of follower on ETF daily returns
//               (window --roll=90 bars, ending strictly before the print date so
//               the event-window return never leaks into its own fit);
//               prediction = beta × realized ETF event-window return.
//   Engine B  — direct-pair event-window beta across the driver's past events,
//               Newey-West SEs, shrunk toward the pooled sector event beta
//               (w = n/(n+K), --shrink-k=6). Split-half betas for stability,
//               plus the residual (SPY-stripped) and lagged daily variants.
//   Windows   — session-aware (doc §1): AM print = T-1 close → T close;
//               PM/TBD = T close → T+1 close. The driver's session defines the
//               window applied to driver, ETF, and follower alike.
//   Isolation — FOMC (exact dates: hardcoded 2021–24 + build.mjs baseline) and
//               NFP (first-Friday rule) HARD-exclude an event from estimation.
//               CPI/PPI proximity is only an approximate day-of-month window
//               (BLS blocks schedule scraping), so it FLAGS instead of excludes
//               — the residual variant is the principled control for shared
//               macro shocks. Follower-reports-in-window always excludes that
//               pair-event (self-event). Bank earnings cluster (JPM/C share a
//               morning), so same-sector overlap would gut n if hard-excluded:
//               every pair is therefore reported under TWO variants — STRICT
//               (shared-print + CPI-flagged events excluded, the doc-pure read)
//               and SHARED (only hard excludes; flags annotated).
//   Gates     — R² > 0.25, NW p < 0.05, direction hit ≥ 60%, BH-FDR (q=0.10)
//               across all pairs per variant (doc §7).
//   Edge      — avg realized follower move in the driver's direction minus the
//               follower's current priced move (ATM_IV/√252) (doc §6).
//
// No writes to data/ or the store. The only write is the Nasdaq back-walk cache
// in os.tmpdir() (--no-cache disables).
//
// Usage:
//   node scripts/diagnose-spillover.mjs [--years=5] [--etf=XLF|KBE] [--roll=90]
//        [--shrink-k=6] [--no-cache]

import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import YahooFinance from "yahoo-finance2";
// The stat/window/isolation core is single-sourced in build.mjs's EVENT
// SPILLOVER MATRIX block (shared with the bake) — change it there only.
import {
  olsNeweyWest, bhFdrThreshold,
  spillPrepSeries, spilloverWindowReturn, spillRollingBeta,
  buildSpilloverMacroSets, spillIsolate,
} from "./build.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "..", "data");

// ---- Config -----------------------------------------------------------------
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }),
);
const YEARS = Math.min(8, Math.max(1, Number(args.years) || 5));
const ETF = String(args.etf || "XLF").toUpperCase() === "KBE" ? "KBE" : "XLF";
const ROLL = Math.min(252, Math.max(40, Number(args.roll) || 90));
const SHRINK_K = Math.max(1, Number(args["shrink-k"]) || 6);
const USE_CACHE = !args["no-cache"];

const PILOT = ["JPM", "BAC", "C", "GS", "MS"]; // drivers AND followers (doc §3)
// Large financials whose prints contaminate the sector read but which are not
// followers (doc §3/§8). The pilot banks contaminate each other too.
const CONTAMINATORS = ["WFC", "USB", "PNC", "TFC", "SCHW", "COF", "BLK", "BK", "AXP", "STT"];
// Every name here is a stable before-open reporter (superset of the bank rows
// in build.mjs's EARNINGS_BMO_REPORTERS) — Nasdaq's historical rows say
// "time-not-supplied", so the session comes from this map.
const SESSION_AM = new Set([...PILOT, ...CONTAMINATORS]);
const NW_LAG_DAILY = 5;  // doc §5 Engine A
const NW_LAG_EVENT = 2;  // sparse event series
const MIN_EVENTS = 6;    // below this, stats print but are marked insufficient
const GATE_R2 = 0.25, GATE_P = 0.05, GATE_HIT = 0.6, FDR_Q = 0.1; // doc §7
const NEAR_ZERO_X = 0.0005; // |driver ret| below this → no direction to score

const yf = new YahooFinance({
  suppressNotices: ["yahooSurvey"],
  validation: { logErrors: false },
  fetchOptions: {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    },
  },
});

// ---- Small utilities --------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const fmt = (v, d = 2, w = 0) => (v == null || !isFinite(v) ? "—".padStart(w || 1) : v.toFixed(d).padStart(w || 1));
const pct = (v, d = 2, w = 0) => (v == null || !isFinite(v) ? "—".padStart(w || 1) : ((v >= 0 ? "+" : "") + (v * 100).toFixed(d) + "%").padStart(w || 1));

async function runPooled(items, limit, fn) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(limit, queue.length) }, async () => {
      while (queue.length) await fn(queue.shift());
    }),
  );
}

// ---- Daily bars (window/rolling math imported from build.mjs) ---------------
async function fetchBars(symbol, years) {
  const period2 = new Date();
  const period1 = new Date(period2.getTime() - (years + 0.4) * 365.25 * 86400000);
  const r = await yf.chart(symbol, { period1, period2, interval: "1d" });
  const rows = (r?.quotes || [])
    .filter((q) => q && q.close != null && q.date)
    .map((q) => ({ t: new Date(q.date).toISOString().slice(0, 10), c: q.close }));
  return spillPrepSeries(rows);
}

// ---- Driver event discovery -------------------------------------------------
// Three sources, merged (±3-day dedupe), best session wins:
//   1. Nasdaq's per-date earnings calendar over the Jan/Apr/Jul/Oct reporting
//      windows (~70 dates/yr). Nasdaq's WAF blocks bursts HARD (a concurrency-8
//      walk earned this machine an hours-long Access-Denied), so the walk is
//      SEQUENTIAL, ~1.2s-paced, and gives up after a run of consecutive blocks;
//      successes (including genuinely empty days) cache under os.tmpdir() and
//      coverage fills incrementally across runs.
//   2. Yahoo's visualization earnings archive (real BMO/AMC sessions, ~20
//      prints/name, frozen mid-2025 upstream). Crumb-gated — skipped with a
//      note when the cookie/crumb handshake fails on this network.
//   3. data/earnings-history.json (when hydrated) — authoritative recents.
// Sources 1+2 also feed reportersByDate (the shared-print/self-event scan).
function reportingWindowDates(years) {
  const today = new Date().toISOString().slice(0, 10);
  const start = new Date(Date.now() - years * 365.25 * 86400000);
  const dates = [];
  for (let y = start.getUTCFullYear(); y <= Number(today.slice(0, 4)); y++) {
    for (const m of [1, 4, 7, 10]) {
      for (let d = 6; d <= 31; d++) {
        const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        const dt = new Date(iso + "T00:00:00Z");
        if (dt.getUTCMonth() !== m - 1) continue; // day overflow
        const wd = dt.getUTCDay();
        if (wd === 0 || wd === 6) continue;
        if (iso < start.toISOString().slice(0, 10) || iso >= today) continue;
        dates.push(iso);
      }
    }
  }
  return dates;
}

const CACHE_PATH = join(tmpdir(), "stonks-spillover-nasdaq-cache.json");
const NASDAQ_PACE_MS = 1200;
const NASDAQ_GIVEUP_AFTER = 8; // consecutive blocked responses → WAF engaged, stop

async function nasdaqDay(date) {
  // Returns { rows: {SYM: "AM"|"PM"|"TBD"} } on success (possibly empty rows)
  // or { blocked: true } on WAF/network/parse failure.
  try {
    const res = await fetch(`https://api.nasdaq.com/api/calendar/earnings?date=${date}`, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        accept: "application/json, text/plain, */*",
        "accept-language": "en-US,en;q=0.9",
        referer: "https://www.nasdaq.com/market-activity/earnings",
        origin: "https://www.nasdaq.com",
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return { blocked: true };
    const json = await res.json();
    if (!json || typeof json !== "object" || !("data" in json)) return { blocked: true };
    const out = {};
    for (const r of json?.data?.rows || []) {
      const sym = String(r?.symbol || "").toUpperCase().trim();
      if (!sym) continue;
      const t = String(r?.time || "").toLowerCase();
      out[sym] = t.includes("pre") ? "AM" : t.includes("after") || t.includes("post") ? "PM" : "TBD";
    }
    return { rows: out };
  } catch {
    return { blocked: true };
  }
}

// Yahoo visualization archive — a local port of build.mjs's unexported
// fetchYahooEarningsDates (doc §14). Throws on crumb failure; caller degrades.
async function vizEarningsDates(sym, size = 24) {
  const body = {
    sortType: "DESC", entityIdType: "earnings", sortField: "startdatetime",
    includeFields: ["ticker", "startdatetime", "startdatetimetype"],
    query: { operator: "and", operands: [{ operator: "eq", operands: ["ticker", sym] }] },
    offset: 0, size,
  };
  const res = await yf._fetch(
    "https://query1.finance.yahoo.com/v1/finance/visualization",
    { lang: "en-US", region: "US" },
    { fetchOptions: { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } } },
    "json", true,
  );
  const doc = res?.finance?.result?.[0]?.documents?.[0];
  const cols = (doc?.columns || []).map((c) => c?.id);
  const iDate = cols.indexOf("startdatetime"), iType = cols.indexOf("startdatetimetype");
  const today = new Date().toISOString().slice(0, 10);
  const out = [];
  for (const row of doc?.rows || []) {
    const date = typeof row?.[iDate] === "string" ? row[iDate].slice(0, 10) : null;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date >= today) continue;
    const type = String(row?.[iType] || "").toUpperCase();
    out.push({ date, session: type === "BMO" ? "AM" : type === "AMC" ? "PM" : "TBD" });
  }
  return out;
}

const SESSION_RANK = { TBD: 0, AM: 1, PM: 1 };
function mergeEvent(list, ev) {
  const near = list.find((e) => Math.abs(new Date(e.date) - new Date(ev.date)) <= 3 * 86400000);
  if (!near) { list.push(ev); return true; }
  if (SESSION_RANK[ev.session] > SESSION_RANK[near.session] || ev.source === "store") {
    near.session = ev.session === "TBD" ? near.session : ev.session;
    near.source = ev.source;
  }
  return false;
}

async function discoverEvents(years, watchSyms) {
  const startIso = new Date(Date.now() - years * 365.25 * 86400000).toISOString().slice(0, 10);
  const notes = { blockedDates: 0, vizOk: true, vizNames: 0 };

  // 1. Nasdaq back-walk (cached, sequential, WAF-aware).
  let cache = {};
  if (USE_CACHE) {
    try { cache = JSON.parse(await readFile(CACHE_PATH, "utf8")) || {}; } catch { /* first run */ }
  }
  const wanted = reportingWindowDates(years);
  const missing = wanted.filter((d) => !cache[d]);
  if (missing.length) {
    console.log(`  Nasdaq back-walk: ${missing.length} uncached dates (of ${wanted.length}), sequential ~${NASDAQ_PACE_MS}ms pace …`);
    let consec = 0, fetched = 0;
    for (let i = 0; i < missing.length; i++) {
      const r = await nasdaqDay(missing[i]);
      if (r.blocked) {
        consec += 1;
        notes.blockedDates += 1;
        if (consec >= NASDAQ_GIVEUP_AFTER) {
          notes.blockedDates += missing.length - i - 1;
          console.log(`  ⚠ Nasdaq WAF engaged after ${fetched} fetches — giving up on ${missing.length - i - 1} remaining dates this run.`);
          break;
        }
      } else {
        consec = 0; fetched += 1;
        cache[missing[i]] = r.rows;
      }
      await sleep(NASDAQ_PACE_MS + Math.random() * 500);
    }
    if (fetched) console.log(`  Nasdaq back-walk: +${fetched} dates fetched this run.`);
    if (USE_CACHE && fetched) {
      try { await writeFile(CACHE_PATH, JSON.stringify(cache)); } catch { /* tmp write is best-effort */ }
    }
  } else {
    console.log(`  Nasdaq back-walk: all ${wanted.length} dates cached (${CACHE_PATH})`);
  }

  const reportersByDate = new Map();
  const addReporter = (date, sym) => {
    if (!reportersByDate.has(date)) reportersByDate.set(date, new Set());
    reportersByDate.get(date).add(sym);
  };
  const eventsByDriver = new Map(PILOT.map((s) => [s, []]));
  for (const date of wanted) {
    const rows = cache[date];
    if (!rows) continue;
    for (const sym of Object.keys(rows)) {
      if (!watchSyms.has(sym)) continue;
      addReporter(date, sym);
      if (eventsByDriver.has(sym)) {
        const session = rows[sym] === "AM" || rows[sym] === "PM" ? rows[sym] : SESSION_AM.has(sym) ? "AM" : "TBD";
        mergeEvent(eventsByDriver.get(sym), { date, session, source: "nasdaq" });
      }
    }
  }

  // 2. Yahoo visualization archive (crumb-gated; fills the WAF-blocked ranges).
  for (const sym of [...watchSyms]) {
    if (!notes.vizOk) break;
    try {
      const evs = await vizEarningsDates(sym);
      notes.vizNames += 1;
      for (const ev of evs) {
        if (ev.date < startIso) continue;
        addReporter(ev.date, sym);
        if (eventsByDriver.has(sym)) {
          const session = ev.session === "TBD" && SESSION_AM.has(sym) ? "AM" : ev.session;
          mergeEvent(eventsByDriver.get(sym), { date: ev.date, session, source: "viz" });
        }
      }
      await sleep(400);
    } catch {
      notes.vizOk = false;
      console.log(`  (Yahoo earnings archive unavailable on this network — cookie/crumb handshake failed; continuing without it)`);
    }
  }

  // 3. data/earnings-history.json (hydrated checkouts only).
  let merged = 0;
  try {
    const store = JSON.parse(await readFile(resolve(DATA_DIR, "earnings-history.json"), "utf8"));
    for (const sym of PILOT) {
      const evs = store?.tickers?.[sym]?.events;
      if (!Array.isArray(evs)) continue;
      for (const ev of evs) {
        if (!ev?.date || !/^\d{4}-\d{2}-\d{2}$/.test(ev.date) || ev.date < startIso) continue;
        addReporter(ev.date, sym);
        const session = ev.session === "AM" || ev.session === "PM" ? ev.session : "AM";
        if (mergeEvent(eventsByDriver.get(sym), { date: ev.date, session, source: "store" })) merged += 1;
      }
    }
  } catch { /* not hydrated — fine */ }
  if (merged) console.log(`  +${merged} events merged from data/earnings-history.json`);
  if (notes.blockedDates) {
    console.log(`  ⚠ ${notes.blockedDates} back-walk dates still unfetched (WAF) — coverage below is PARTIAL; re-run later, the cache fills incrementally.`);
  }
  return { reportersByDate, eventsByDriver, notes };
}

// ---- Priced move (doc §6): ATM ~30d IV, first source that works -------------
async function atmIvYahoo(sym) {
  const o1 = await yf.options(sym, {});
  const spot = o1?.quote?.regularMarketPrice;
  const exps = (o1?.expirationDates || []).map((d) => new Date(d));
  if (!(spot > 0) || !exps.length) return null;
  const now = Date.now();
  let best = null, bestDist = Infinity;
  for (const d of exps) {
    const dte = (d.getTime() - now) / 86400000;
    if (dte < 7) continue;
    if (Math.abs(dte - 30) < bestDist) { best = d; bestDist = Math.abs(dte - 30); }
  }
  if (!best) return null;
  const o2 = await yf.options(sym, { date: best });
  const ch = o2?.options?.[0];
  const near = (rows) =>
    (rows || []).reduce((b, r) => (r?.strike > 0 && (!b || Math.abs(r.strike - spot) < Math.abs(b.strike - spot)) ? r : b), null);
  const c = near(ch?.calls), p = near(ch?.puts);
  const ivs = [c?.impliedVolatility, p?.impliedVolatility].filter((v) => v > 0.01 && v < 5);
  return ivs.length ? { iv: mean(ivs), source: "yahoo" } : null;
}

async function atmIvCboe(sym) {
  const res = await fetch(`https://cdn.cboe.com/api/global/delayed_quotes/options/${sym}.json`, {
    headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return null;
  const j = await res.json();
  const spot = j?.data?.current_price;
  const rows = j?.data?.options;
  if (!(spot > 0) || !Array.isArray(rows)) return null;
  const now = Date.now();
  const parsed = [];
  for (const r of rows) {
    const m = String(r?.option || "").match(/^([A-Z.]{1,6})(\d{6})([CP])(\d{8})$/);
    if (!m) continue;
    const exp = new Date(`20${m[2].slice(0, 2)}-${m[2].slice(2, 4)}-${m[2].slice(4, 6)}T00:00:00Z`);
    const dte = (exp.getTime() - now) / 86400000;
    if (dte < 7) continue;
    parsed.push({ dte, side: m[3], strike: Number(m[4]) / 1000, iv: r?.iv });
  }
  if (!parsed.length) return null;
  const bestDte = parsed.reduce((b, r) => (Math.abs(r.dte - 30) < Math.abs(b - 30) ? r.dte : b), Infinity);
  const atExp = parsed.filter((r) => r.dte === bestDte);
  const near = (side) =>
    atExp.filter((r) => r.side === side).reduce((b, r) => (!b || Math.abs(r.strike - spot) < Math.abs(b.strike - spot) ? r : b), null);
  const ivs = [near("C")?.iv, near("P")?.iv].filter((v) => v > 0.01 && v < 5);
  return ivs.length ? { iv: mean(ivs), source: "cboe" } : null;
}

async function atmIvLocal(sym) {
  try {
    const j = JSON.parse(await readFile(resolve(DATA_DIR, "iv-history", `${sym}.json`), "utf8"));
    const last = j?.entries?.[j.entries.length - 1];
    return last?.iv > 0 ? { iv: last.iv, source: `iv-history@${last.date}` } : null;
  } catch { return null; }
}

async function fetchPricedMove(sym) {
  for (const fn of [atmIvYahoo, atmIvCboe, atmIvLocal]) {
    try {
      const r = await fn(sym);
      if (r) return { pricedMove: r.iv / Math.sqrt(252), ...r };
    } catch { /* next source */ }
  }
  return null;
}

// ---- Main -------------------------------------------------------------------
console.log(`=== Event Spillover Matrix — Phase 1 backtest (docs/event-spillover.md) ===`);
console.log(`Pilot: ${PILOT.join(" ")} · ETF ${ETF} · ${YEARS}y lookback · roll ${ROLL} bars · shrink K=${SHRINK_K}\n`);

// 1. Bars.
const barSyms = [...PILOT, ETF, "SPY"];
const bars = {};
console.log(`Fetching daily bars (${barSyms.join(", ")}) …`);
for (const sym of barSyms) {
  try {
    bars[sym] = await fetchBars(sym, YEARS);
    console.log(`  ${sym}: ${bars[sym].rows.length} bars (${bars[sym].rows[0]?.t} … ${bars[sym].rows[bars[sym].rows.length - 1]?.t})`);
  } catch (e) {
    console.log(`  ${sym}: FAILED (${e?.message?.slice(0, 80)})`);
  }
  await sleep(350);
}
for (const sym of [...PILOT, ETF, "SPY"]) {
  if (!bars[sym]?.rows?.length) {
    console.log(`\nCannot continue without ${sym} bars.`);
    process.exit(1);
  }
}

// 2. Events.
console.log(`\nDiscovering driver events …`);
const watchSyms = new Set([...PILOT, ...CONTAMINATORS]);
const { reportersByDate, eventsByDriver } = await discoverEvents(YEARS, watchSyms);
for (const list of eventsByDriver.values()) list.sort((a, b) => (a.date < b.date ? -1 : 1));

// 3. Isolation + window returns per driver event.
const macro = buildSpilloverMacroSets(YEARS);
const perDriver = new Map(); // driver -> [{date, session, win, etfRet, spyRet, iso}]
for (const driver of PILOT) {
  const rows = [];
  for (const ev of eventsByDriver.get(driver)) {
    const win = spilloverWindowReturn(bars[driver], ev.date, ev.session);
    if (!win) continue;
    const etfWin = spilloverWindowReturn(bars[ETF], ev.date, ev.session);
    const spyWin = spilloverWindowReturn(bars.SPY, ev.date, ev.session);
    const iso = spillIsolate(win.startDate, win.endDate, macro, reportersByDate, driver);
    rows.push({ ...ev, win, etfRet: etfWin?.ret ?? null, spyRet: spyWin?.ret ?? null, iso });
  }
  perDriver.set(driver, rows);
}

console.log(`\n--- Driver event coverage & isolation ---`);
for (const driver of PILOT) {
  const rows = perDriver.get(driver);
  const hard = rows.filter((r) => r.iso.hard.length).length;
  const shared = rows.filter((r) => !r.iso.hard.length && r.iso.flags.some((f) => f.startsWith("shared"))).length;
  const cpi = rows.filter((r) => !r.iso.hard.length && r.iso.flags.includes("cpi/ppi-approx")).length;
  const strictClean = rows.filter((r) => !r.iso.hard.length && !r.iso.flags.length).length;
  const src = rows.reduce((m, r) => ((m[r.source] = (m[r.source] || 0) + 1), m), {});
  console.log(
    `  ${driver}: ${String(rows.length).padStart(2)} events (${rows[0]?.date ?? "—"} … ${rows[rows.length - 1]?.date ?? "—"})` +
    ` · hard-excluded ${hard} (FOMC/NFP) · shared-print ${shared} · cpi-flag ${cpi} · strictly clean ${strictClean}` +
    ` · src ${Object.entries(src).map(([k, v]) => `${k}:${v}`).join(" ")}`,
  );
}
console.log(`  (banks cluster: "shared" = another large financial reported inside the window — see variant note above)`);

// 4. Pair tables under both variants.
const spyBeta = {}; // full-sample beta to SPY for the residual variant
for (const sym of [...PILOT]) {
  const fit = spillRollingBeta(bars[sym], bars.SPY, "9999-12-31", 100000, NW_LAG_DAILY);
  spyBeta[sym] = fit?.b ?? 1;
}

function pairEvents(driver, follower, variant) {
  const out = [];
  for (const r of perDriver.get(driver)) {
    if (r.iso.hard.length) continue;
    const sharedSyms = r.iso.flags.filter((f) => f.startsWith("shared:")).flatMap((f) => f.slice(7).split("+"));
    if (sharedSyms.includes(follower)) continue; // self-event: follower printed in-window
    if (variant === "strict" && r.iso.flags.length) continue;
    const fWin = spilloverWindowReturn(bars[follower], r.date, r.session);
    if (!fWin || r.etfRet == null) continue;
    out.push({ date: r.date, x: r.win.ret, y: fWin.ret, etf: r.etfRet, spy: r.spyRet });
  }
  return out;
}

const variants = ["strict", "shared"];
const pairStats = { strict: [], shared: [] };
for (const variant of variants) {
  // Pooled sector event-beta across all pairs (shrinkage target, doc §5B).
  const poolX = [], poolY = [];
  const pairEv = new Map();
  for (const d of PILOT) for (const f of PILOT) {
    if (d === f) continue;
    const evs = pairEvents(d, f, variant);
    pairEv.set(`${d}>${f}`, evs);
    for (const e of evs) { poolX.push(e.x); poolY.push(e.y); }
  }
  const pooled = olsNeweyWest(poolX, poolY, NW_LAG_EVENT);
  for (const d of PILOT) for (const f of PILOT) {
    if (d === f) continue;
    const evs = pairEv.get(`${d}>${f}`);
    const n = evs.length;
    const row = { driver: d, follower: f, n, pooledB: pooled?.b ?? null };
    if (n >= 3) {
      const fit = olsNeweyWest(evs.map((e) => e.x), evs.map((e) => e.y), NW_LAG_EVENT);
      if (fit) {
        const w = n / (n + SHRINK_K);
        row.b = fit.b; row.r2 = fit.r2; row.t = fit.t; row.p = fit.p;
        row.bShrunk = pooled ? w * fit.b + (1 - w) * pooled.b : fit.b;
        row.w = w;
        // Split-half stability (doc §7 split-sample gate).
        const half = Math.floor(n / 2);
        const f1 = olsNeweyWest(evs.slice(0, half).map((e) => e.x), evs.slice(0, half).map((e) => e.y), NW_LAG_EVENT);
        const f2 = olsNeweyWest(evs.slice(half).map((e) => e.x), evs.slice(half).map((e) => e.y), NW_LAG_EVENT);
        row.bH1 = f1?.b ?? null; row.bH2 = f2?.b ?? null;
        // Residual (SPY-stripped) variant — gate on t + sign, NOT R² (doc §5).
        const rx = evs.filter((e) => e.spy != null).map((e) => e.x - spyBeta[d] * e.spy);
        const ry = evs.filter((e) => e.spy != null).map((e) => e.y - spyBeta[f] * e.spy);
        const rfit = olsNeweyWest(rx, ry, NW_LAG_EVENT);
        row.bResid = rfit?.b ?? null; row.tResid = rfit?.t ?? null;
        row.residSignAgree = rfit && fit ? Math.sign(rfit.b) === Math.sign(fit.b) : null;
        // Engine B scoring with the shrunk beta.
        let hits = 0, scored = 0, maeB = 0;
        for (const e of evs) {
          maeB += Math.abs(row.bShrunk * e.x - e.y);
          if (Math.abs(e.x) < NEAR_ZERO_X) continue;
          scored += 1;
          if (Math.sign(row.bShrunk * e.x) === Math.sign(e.y)) hits += 1;
        }
        row.hitB = scored ? hits / scored : null;
        row.maeB = maeB / n;
        // Engine A: rolling follower→ETF beta as-of each event; predict off the
        // realized ETF window move (doc §5A backtest form).
        let hitsA = 0, scoredA = 0, maeA = 0, nA = 0;
        for (const e of evs) {
          const fitA = spillRollingBeta(bars[f], bars[ETF], e.date, ROLL, NW_LAG_DAILY);
          if (!fitA) continue;
          const pred = fitA.b * e.etf;
          nA += 1; maeA += Math.abs(pred - e.y);
          if (Math.abs(pred) < NEAR_ZERO_X) continue;
          scoredA += 1;
          if (Math.sign(pred) === Math.sign(e.y)) hitsA += 1;
        }
        row.hitA = scoredA ? hitsA / scoredA : null;
        row.maeA = nA ? maeA / nA : null;
        row.avgAligned = mean(evs.map((e) => e.y * Math.sign(e.x)));
      }
    }
    pairStats[variant].push(row);
  }
  const thr = bhFdrThreshold(pairStats[variant].map((r) => r.p), FDR_Q);
  for (const r of pairStats[variant]) {
    r.fdrPass = r.p != null && thr != null && r.p <= thr;
    r.gates =
      r.n >= MIN_EVENTS &&
      r.r2 != null && r.r2 > GATE_R2 &&
      r.p != null && r.p < GATE_P &&
      r.hitB != null && r.hitB >= GATE_HIT;
  }
}

// 5. Engine A reference betas (latest, full roll window) + driver→ETF link.
console.log(`\n--- Engine A: latest rolling betas vs ${ETF} (${ROLL}-bar, Newey-West lag ${NW_LAG_DAILY}) ---`);
console.log(`  name    β→${ETF}     R²     t(NW)`);
for (const sym of PILOT) {
  const fit = spillRollingBeta(bars[sym], bars[ETF], "9999-12-31", ROLL, NW_LAG_DAILY);
  console.log(`  ${sym.padEnd(6)} ${fmt(fit?.b, 2, 6)} ${fmt(fit?.r2, 2, 6)} ${fmt(fit?.t, 1, 8)}`);
}

// 6. Priced moves (live ATM ~30d IV → 1-day move).
console.log(`\nFetching follower ATM IV (priced move) …`);
const priced = {};
await runPooled(PILOT, 2, async (sym) => {
  priced[sym] = await fetchPricedMove(sym);
});
for (const sym of PILOT) {
  const p = priced[sym];
  console.log(`  ${sym.padEnd(6)} ${p ? `IV ${(p.iv * 100).toFixed(1)}% → 1d priced move ${(p.pricedMove * 100).toFixed(2)}% (${p.source})` : "unavailable (all sources failed)"}`);
}

// 7. Pair matrix per variant.
for (const variant of variants) {
  const label = variant === "strict"
    ? "STRICT (doc-pure: shared-print + CPI-flagged events excluded)"
    : "SHARED (only FOMC/NFP + self-events excluded; shared prints included)";
  console.log(`\n--- Engine B pair matrix — ${label} ---`);
  console.log(`  pair       n   β_raw β_shr(w)     R²   t(NW)      p  FDR  hitB   maeB  hitA   maeA  avg|→   βH1/βH2  resid(t)  gates`);
  for (const r of pairStats[variant]) {
    const halves = r.bH1 != null && r.bH2 != null ? `${fmt(r.bH1, 1)}/${fmt(r.bH2, 1)}` : "—";
    const resid = r.bResid != null ? `${fmt(r.bResid, 2)}(${fmt(r.tResid, 1)})${r.residSignAgree === false ? "✗" : ""}` : "—";
    console.log(
      `  ${r.driver}>${r.follower}`.padEnd(11) +
      `${String(r.n).padStart(3)} ` +
      `${fmt(r.b, 2, 7)} ${fmt(r.bShrunk, 2, 5)}${r.w != null ? `(${r.w.toFixed(2)})` : "      "} ` +
      `${fmt(r.r2, 2, 6)} ${fmt(r.t, 1, 7)} ${fmt(r.p, 3, 6)}  ${r.fdrPass ? "✓" : "·"}  ` +
      `${r.hitB != null ? (r.hitB * 100).toFixed(0).padStart(3) + "%" : "  —"} ${pct(r.maeB, 2, 7)} ` +
      `${r.hitA != null ? (r.hitA * 100).toFixed(0).padStart(3) + "%" : "  —"} ${pct(r.maeA, 2, 7)} ` +
      `${pct(r.avgAligned, 2, 7)} ${halves.padStart(9)} ${resid.padStart(10)}  ` +
      (r.n < MIN_EVENTS ? "n<" + MIN_EVENTS : r.gates ? "PASS" : "fail"),
    );
  }
}

// 8. Edge ranking (doc §6) on the SHARED variant (larger n; strict shown above).
console.log(`\n--- Edge ranking (SHARED variant): avg realized move in driver's direction − current priced move ---`);
const ranked = pairStats.shared
  .filter((r) => r.avgAligned != null)
  .map((r) => {
    const pm = priced[r.follower]?.pricedMove ?? null;
    return { ...r, pricedMove: pm, edge: pm != null ? r.avgAligned - pm : null };
  })
  .sort((a, b) => (b.edge ?? -Infinity) - (a.edge ?? -Infinity));
console.log(`  pair        avg|→  priced    edge  qualified(gates+FDR)`);
for (const r of ranked) {
  console.log(
    `  ${r.driver}>${r.follower}`.padEnd(12) +
    `${pct(r.avgAligned, 2, 7)} ${pct(r.pricedMove, 2, 7)} ${pct(r.edge, 2, 7)}  ` +
    (r.gates && r.fdrPass ? "YES" : r.gates ? "gates-only" : "no"),
  );
}

// 9. Lead/lag appendix (doc §5, lagged variant) — daily returns, full sample.
console.log(`\n--- Lead/lag (daily): corr(driver t−1 → follower t) vs corr(follower t−1 → driver t) ---`);
function laggedCorr(aBars, bBars) {
  // corr of a's return at t−1 with b's return at t over all common dates.
  const xs = [], ys = [];
  for (let i = 2; i < bBars.rows.length; i++) {
    const t = bBars.rows[i].t, tPrev = bBars.rows[i - 1].t;
    const j = aBars.idx.get(tPrev);
    if (j == null || j === 0) continue;
    xs.push(aBars.rows[j].c / aBars.rows[j - 1].c - 1);
    ys.push(bBars.rows[i].c / bBars.rows[i - 1].c - 1);
  }
  const fit = olsNeweyWest(xs, ys, NW_LAG_DAILY);
  return fit ? Math.sign(fit.b) * Math.sqrt(Math.max(0, fit.r2)) : null;
}
for (const d of PILOT) for (const f of PILOT) {
  if (d >= f) continue; // unordered pairs once
  const df = laggedCorr(bars[d], bars[f]);
  const fd = laggedCorr(bars[f], bars[d]);
  const lead = df != null && fd != null ? (Math.abs(df) > Math.abs(fd) ? d : f) : "—";
  console.log(`  ${d}↔${f}: ${d}→${f} ${fmt(df, 3, 7)} · ${f}→${d} ${fmt(fd, 3, 7)}  → ${lead} tends to lead`);
}

console.log(`\nReading: a pair is a real read-through only when the Engine B gates hold (R²>${GATE_R2},`);
console.log(`NW p<${GATE_P}, hit≥${GATE_HIT * 100}%, n≥${MIN_EVENTS}) AND it survives BH-FDR — and it is only *interesting*`);
console.log(`when edge > 0 (it realizes more than its options charge). STRICT is the doc-pure read;`);
console.log(`SHARED reflects how bank prints actually cluster — if the two disagree, trust STRICT's`);
console.log(`sign and treat SHARED's magnitude as an upper bound. The residual column is the control`);
console.log(`for shared macro shocks (gate it on t + sign stability, never R²). MAE/hit here are`);
console.log(`in-sample for Engine B (βH1/βH2 is the out-of-sample stability read); Engine A is as-of`);
console.log(`fitted and honestly out-of-sample. Nothing in this report is a trade recommendation.`);

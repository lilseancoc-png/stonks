// Offline checks for the daily Webull data runner and the option price saver
// (lib/webull-data/, docs/webull-data.md). A fake Webull answers with the
// shapes the 2026-11-19 paper-key probe recorded; a fake store keeps objects
// in memory; a fake clock drives the per-minute caps. No network.
// Run: node scripts/webull-data-smoke.mjs
import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { parseOcc, occSymbol, chainRow, selectContracts, snapshotRow, barsBySymbol, barDate, chunk, DEFAULTS } from "../lib/webull-data/options.mjs";
import { runWebullData, sessionOf, makeLimiter, statusView, DEFAULT_RPM } from "../lib/webull-data/runner.mjs";
import { webullDataKeys, readGz, isWebullDataKey } from "../lib/webull-data/store.mjs";
import { WEBULL_DATA_JOBS } from "../lib/webull-data/jobs/index.mjs";
import { expiryWindow } from "../lib/webull-data/jobs/option-expiry.mjs";
import { backfillDates } from "../lib/webull-data/jobs/option-snapshots.mjs";
import { WEBULL_DATA_TICKERS } from "../lib/webull-data/universe.mjs";
import { researchUniverse } from "../lib/site-catalog/universe.mjs";
import { createWebullClient, WebullError } from "../lib/webull-client.mjs";
import { webullDataTriggerToken } from "../lib/webull-data/trigger.mjs";
import { mirrorTriggerToken } from "../lib/webull-mirror.mjs";
import { routeRun, LABELS as TRIGGER_LABELS } from "./webull-data-trigger.mjs";
import { exportWebullOptions } from "./webull-options-export.mjs";
import { mkdtempSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let checks = 0;
const ok = (v, m) => { assert.ok(v, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

// --- OCC symbols and rows ----------------------------------------------------------
eq(parseOcc("AAPL270115C00350000"), { root: "AAPL", expiry: "2027-01-15", right: "C", strike: 350 }, "OCC parse");
eq(parseOcc("SPY261120P00672500").strike, 672.5, "half-dollar strike");
eq(parseOcc("AAPL271315C00350000"), null, "bad month refused");
eq(occSymbol("AAPL", "2027-01-15", "C", 350), "AAPL270115C00350000", "OCC build");
eq(occSymbol("SPY", "2026-11-20", "P", 672.5), "SPY261120P00672500", "OCC build, half strike");
eq(occSymbol("aapl", "2027-01-15", "X", 350), null, "bad right refused");
const probeContract = { instrument_id: "1044604142", symbol: "AAPL261218P00350000", status: "LISTING", tradable_status: "OC", expiration_date: "2026-12-18",
  init_expiration_date: "2026-12-18", root_symbol: "AAPL", underlying_symbol: "AAPL", underlying_type: "EQUITY_PUT_OPTION", option_type: "PUT", style: "AMERICAN",
  strike_price: "350.0000000000", multiplier: "100.0000000000", settlement_method: "PHYSICAL", expired_cycle: "MONTHLY", ppind: true, currency: "USD", def_type: "STANDARD" };
eq(chainRow(probeContract), { s: "AAPL261218P00350000", e: "2026-12-18", k: 350, t: "P", cy: "MONTHLY", pp: 1 }, "contract row from the probe sample");
eq(chainRow({ ...probeContract, root_symbol: "AAPL1" }), null, "adjusted contract (root differs) skipped");
eq(chainRow({ ...probeContract, tradable_status: "NT" }), null, "non-tradable skipped");
eq(chainRow({ ...probeContract, multiplier: "50" }), null, "non-100 multiplier skipped");
const probeSnap = { symbol: "AAPL270115C00350000", price: "12.90", open: "16.30", high: "17.30", low: "12.90", volume: "3629", change: "-3.30", close: "12.90", gamma: "0.0116",
  delta: "0.545", rho: "0.289", theta: "-0.1123", vega: "0.5485", bid: "13.10", ask: "13.55", instrument_id: "1048032387", pre_close: "16.20", change_ratio: "-0.2037",
  last_trade_time: 1795107975001, strike_price: "350.00", imp_vol: "0.2457", open_interest: "58640", quote_time: 1795108083806, ask_size: "206", bid_size: "228", deal_amount: "50388.23", delay_minutes: 15 };
const row = snapshotRow(probeSnap, { date: "2026-11-19", underlying: "AAPL", spot: 349.2 });
eq([row.bid, row.ask, row.iv, row.oi, row.delta, row.delay_min, row.expiry, row.right, row.strike, row.wide, row.source], [13.1, 13.55, 0.2457, 58640, 0.545, 15, "2027-01-15", "C", 350, false, "webull"], "snapshot row from the probe sample");
eq(row.quote_time, new Date(1795108083806).toISOString(), "quote time kept");
eq(snapshotRow({ ...probeSnap, bid: "9.65", ask: "20" }, {}).wide, true, "wide market flagged");
eq(snapshotRow({ ...probeSnap, bid: "0", ask: "0.05" }, {}).wide, true, "no bid = wide");
eq(barDate("2026-11-18T05:00:00.000+0000"), "2026-11-18", "daily bar stamped at ET midnight (EST)");
eq(barDate("2026-09-14T04:00:00.000+0000"), "2026-09-14", "daily bar stamped at ET midnight (EDT)");
const bars = barsBySymbol([{ symbol: "AAPL261113C00350000", instrument_id: "9", delay_minutes: 15, result: [
  { time: "2026-11-13T05:00:00.000+0000", open: "8.50", close: "6.60", high: "10.65", low: "5.75", volume: "1904" },
  { time: "2026-10-01T04:00:00.000+0000", open: "1", close: "1.1", high: "1.2", low: "0.9", volume: "3" }] }]);
eq(bars.get("AAPL261113C00350000").bars.map((b) => b.date), ["2026-10-01", "2026-11-13"], "bars sorted oldest first");
eq(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]], "chunk");

// Selection: nearest the money in rough standard moves, quota, held kept.
const chain = [];
for (const e of ["2026-11-24", "2026-12-18", "2027-06-17", "2028-01-21"]) for (const k of [80, 90, 95, 100, 105, 110, 120, 140]) for (const t of ["C", "P"]) chain.push({ s: occSymbol("XYZ", e, t, k), e, k, t });
const sel = selectContracts(chain, { spot: 100, date: "2026-11-19", quota: 10, held: [occSymbol("XYZ", "2028-01-21", "C", 140)] });
eq(sel.length, 11, "quota + held");
ok(sel.some((c) => c.held && c.k === 140), "held contract kept outside the band");
ok(sel.every((c) => c.held || (c.e !== "2026-11-24" && Math.abs(c.k / 100 - 1) <= 0.2)), "inside window (7-400 days) and band");
ok(sel.filter((c) => !c.held).every((c) => c.k >= 90 && c.k <= 110), "nearest the money first");
ok(!sel.some((c) => c.e === "2028-01-21" && !c.held), "past 400 days skipped");

// --- calendar ------------------------------------------------------------------------
const at = (iso) => Date.parse(iso);
eq(sessionOf(at("2026-11-19T21:40:00Z")), { date: "2026-11-19", phase: "close" }, "16:40 ET = today's close");
eq(sessionOf(at("2026-11-19T17:00:00Z")), { date: "2026-11-19", phase: "intraday" }, "midday = intraday");
eq(sessionOf(at("2026-11-20T13:00:00Z")), { date: "2026-11-19", phase: "close" }, "before the open = previous session");
eq(sessionOf(at("2026-11-26T20:00:00Z")), { date: "2026-11-25", phase: "close" }, "Thanksgiving = previous session");
eq(expiryWindow("2026-11-23", 5), ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"], "1-5 sessions back, oldest first");
eq(backfillDates("AAPL", "2026-11-19", 8), ["2026-11-13"], "weekly name: Fridays only");
eq(backfillDates("SPY", "2026-11-19", 8), ["2026-11-18", "2026-11-17", "2026-11-16", "2026-11-13", "2026-11-12", "2026-11-11"], "daily-expiry fund: every session");
eq(backfillDates("AAPL", "2026-04-08", 8), ["2026-04-02"], "Good Friday week: Thursday");

// --- universe ------------------------------------------------------------------------
ok(researchUniverse.every((s) => WEBULL_DATA_TICKERS.includes(s)) && ["SPY", "QQQ", "IWM", "TLT", "GLD"].every((s) => WEBULL_DATA_TICKERS.includes(s)), "covered names + engine funds");

// --- client ---------------------------------------------------------------------------
{
  const seen = [];
  const c = createWebullClient({ appKey: "k", appSecret: "s", fetchImpl: async (url, init) => { seen.push({ url, init }); return new Response("[]", { status: 200 }); } });
  await c.get("/market-data/options/snapshots/list", { category: "US_OPTION", symbols: "A,B", empty: null });
  ok(seen[0].url.startsWith("https://api.sandbox.webull.com/market-data/options/snapshots/list?") && seen[0].init.method === "GET", "data GET on the sandbox host");
  ok(!seen[0].url.includes("empty"), "empty params dropped");
  for (const bad of ["/trading/orders/place", "/trading/accounts/list", "/market-data/../trading/orders/place", "/market-data/x?y=1"]) {
    await assert.rejects(c.get(bad), (e) => e.code === "PATH_REFUSED", `refuses ${bad}`); checks++;
  }
}

// --- fake store + fake Webull --------------------------------------------------------------
function fakeStore(seed = {}) {
  const m = new Map(Object.entries(seed));
  return { m, backend: "r2",
    get: async (k) => m.has("data/" + k) ? Buffer.from(m.get("data/" + k)) : null, put: async (k, v) => { m.set("data/" + k, Buffer.from(v)); },
    rawGet: async (k) => m.has(k) ? Buffer.from(m.get(k)) : null, rawPut: async (k, v) => { m.set(k, Buffer.from(v)); }, rawDel: async (k) => { m.delete(k); },
    rawList: async (p) => [...m.keys()].filter((k) => k.startsWith(p)).map((key) => ({ key, size: m.get(key).length })) };
}
const SPOT = { AAPL: 100, SPY: 100 };
function fakeWebull({ clock, expiredAlive = () => true, log = [] } = {}) {
  const page = 1000;
  const fullChain = (u) => {
    const out = [];
    for (const e of ["2026-11-20", "2026-11-27", "2026-12-04", "2026-12-18", "2027-01-15", "2027-06-17"]) for (let k = 70; k <= 130; k += 2.5) for (const t of ["CALL", "PUT"]) {
      out.push({ ...probeContract, symbol: occSymbol(u, e, t[0], k), expiration_date: e, option_type: t, strike_price: String(k), root_symbol: u, underlying_symbol: u });
    }
    return out;
  };
  return {
    log,
    get: async (path, q) => {
      clock.t += 120;
      log.push({ path, q, t: clock.t });
      if (path.endsWith("/stocks/snapshots/list")) return q.symbols.split(",").filter((s) => SPOT[s] && (q.category === "US_ETF") === (s === "SPY")).map((s) => ({ symbol: s, price: String(SPOT[s]), quote_time: clock.t }));
      if (path.endsWith("/options/contracts/list")) {
        const all = fullChain(q.underlying_symbols).filter((c) => Number(c.strike_price) >= Number(q.strike_price_gte) && Number(c.strike_price) <= Number(q.strike_price_lte));
        const start = Number(q.pagination_key || 0);
        const data = all.slice(start, start + page);
        return start + page < all.length ? { data, pagination_key: String(start + page) } : { data };
      }
      if (path.endsWith("/options/snapshots/list")) return q.symbols.split(",").map((s) => ({ ...probeSnap, symbol: s, strike_price: String(parseOcc(s).strike), quote_time: clock.t - 15 * 60000 }));
      if (path.endsWith("/options/bars/list")) {
        const syms = q.symbols.split(",");
        if (syms.some((s) => !expiredAlive(s))) throw new WebullError(`Webull ${path}: Invalid Symbol:[${syms[0]}].`, { status: 417, code: "INVALID_SYMBOL" });
        return syms.map((s) => ({ symbol: s, instrument_id: "1", delay_minutes: 15, result: [
          { time: "2026-11-13T05:00:00.000+0000", open: "2", close: "2.5", high: "3", low: "1.5", volume: "10" },
          { time: "2026-10-01T04:00:00.000+0000", open: "1", close: "1.1", high: "1.2", low: "0.9", volume: "3" }] }));
      }
      throw new Error("unexpected path " + path);
    },
  };
}
const gz = (store, key) => JSON.parse(gunzipSync(store.m.get(key)).toString("utf8"));

// --- first run: snapshots, registry, backfill -------------------------------------------
{
  const clock = { t: at("2026-11-19T21:40:00Z") };
  const store = fakeStore({ "data/picks-accuracy.json": JSON.stringify({ open: [{ symbol: "AAPL", side: "call", contract: { structure: "long", strike: 150, expiry: Date.parse("2027-01-15T21:00:00Z") / 1000 } }] }) });
  // Only the 2026-11-13 weekly still answers; older dates are gone.
  const client = fakeWebull({ clock, expiredAlive: (s) => parseOcc(s).expiry >= "2026-11-13" });
  const opts = { tickers: ["AAPL", "SPY"], maxContracts: "200" };
  let r, pings = 0, waits = 0;
  do {
    r = await runWebullData({ client, store, jobs: WEBULL_DATA_JOBS, nowFn: () => clock.t, options: opts, budgetMs: 40000 });
    pings++;
    if (r.waitMs) { waits++; clock.t += r.waitMs; }
    clock.t += 1000;
  } while (r.more && pings < 200);
  eq(r.more, false, "first run finishes");
  eq(r.date, "2026-11-19", "session date");
  // Per-group cap: never more than 24 calls in any 60 s window.
  const byGroup = {};
  for (const c of client.log) { const g = c.path.split("/").slice(-2).join("/"); (byGroup[g] || (byGroup[g] = [])).push(c.t); }
  for (const [g, ts] of Object.entries(byGroup)) for (let i = 0; i < ts.length; i++) ok(ts.filter((t) => t > ts[i] - 60000 && t <= ts[i]).length <= DEFAULT_RPM, `${g}: at most ${DEFAULT_RPM} calls a minute`);
  const aapl = gz(store, webullDataKeys.snapshot("2026-11-19", "AAPL"));
  eq(aapl.underlying, "AAPL", "snapshot object per name");
  ok(aapl.rows.length >= 100 && aapl.rows.length <= 101, "quota per name (200 / 2 names) + held");
  ok(aapl.rows.some((x) => x.symbol === "AAPL270115C00150000"), "held contract snapshotted outside the band");
  ok(aapl.rows.every((x) => x.expiry >= "2026-11-26"), "nothing under 7 days snapshotted");
  ok(aapl.rows.every((x) => x.stale === false && x.delay_min === 15), "fresh, delayed 15 min");
  ok(store.m.has(webullDataKeys.snapshot("2026-11-19", "SPY")), "fund snapshot (US_ETF category)");
  // Registry: snapshotted contracts and this week's (first run) contracts.
  const reg1120 = gz(store, webullDataKeys.registry("2026-11-20"));
  ok(Object.keys(reg1120.contracts).length > 0, "first run registers this week's soon-to-expire contracts");
  const reg0115 = gz(store, webullDataKeys.registry("2027-01-15"));
  ok(reg0115.contracts.AAPL270115C00150000, "held contract registered");
  // Backfill: the 2026-11-13 weekly answered and was saved; older dates were probed once and skipped.
  const saved = [...store.m.keys()].filter((k) => k.includes("/options/expired/"));
  ok(saved.some((k) => k.includes("/2026-11-13/AAPL261113")), "recently expired AAPL weekly saved");
  ok(saved.every((k) => k.includes("/2026-11-13/") || k.includes("/2026-11-16/") || k.includes("/2026-11-17/") || k.includes("/2026-11-18/")), "only answering dates saved");
  const exp = gz(store, saved.find((k) => k.includes("AAPL261113")));
  eq([exp.first, exp.last, exp.bars.length, exp.source], ["2026-10-01", "2026-11-13", 2, "webull-bars"], "expired contract object");
  const probes11 = client.log.filter((c) => c.path.endsWith("/bars/list") && c.q.symbols.includes("261111"));
  eq(probes11.length, 1, "a gone date costs one probe");
  const state = await readGz(store, webullDataKeys.state());
  ok(state.jobs["option-snapshots"].state.backfillDone === "2026-11-19", "backfill marked done");
  const view = statusView(state, { switches: { WEBULL_DATA: true } });
  ok(view.today.counts["snapshot-contracts"] >= 200 && view.totals.days === 1 && view.today.counts["expired-saved"] > 0, "status view counts");
  ok(!JSON.stringify(view).match(/AAPL|SPY|\d+\.\d{2}"/), "status view carries no ticker or price");
  ok([...store.m.keys()].filter((k) => !k.startsWith("data/")).every(isWebullDataKey), "every write under _stonks/webull-data/v1/");

  // A second ping the same evening does nothing new.
  const before = client.log.length;
  r = await runWebullData({ client, store, jobs: WEBULL_DATA_JOBS, nowFn: () => clock.t, options: opts });
  eq([r.more, client.log.length], [false, before], "done day: no more calls");

  // --- next session: the expiry saver picks up yesterday's registry contracts --------
  clock.t = at("2026-11-20T21:45:00Z");
  r = null; pings = 0;
  do { r = await runWebullData({ client, store, jobs: WEBULL_DATA_JOBS, nowFn: () => clock.t, options: opts }); clock.t += (r.waitMs || 0) + 1000; pings++; } while (r.more && pings < 200);
  eq(r.date, "2026-11-20", "next session");
  ok(!client.log.some((c) => c.t > at("2026-11-20T21:00:00Z") && c.path.endsWith("/bars/list") && c.q.symbols.includes("261111")), "backfill runs once");
  // Monday: Friday 11/20's registry contracts are 1 session past expiry.
  clock.t = at("2026-11-23T21:45:00Z");
  const gone = new Set(["AAPL261120C00100000"]);
  const client2 = fakeWebull({ clock, expiredAlive: (s) => !gone.has(s) });
  pings = 0;
  do { r = await runWebullData({ client: client2, store, jobs: WEBULL_DATA_JOBS, nowFn: () => clock.t, options: opts }); clock.t += (r.waitMs || 0) + 1000; pings++; } while (r.more && pings < 200);
  const regN = Object.keys(gz(store, webullDataKeys.registry("2026-11-20")).contracts);
  const savedN = [...store.m.keys()].filter((k) => k.includes("/options/expired/2026-11-20/"));
  eq(savedN.length, regN.length - (regN.includes("AAPL261120C00100000") ? 1 : 0), "every registry contract of Friday's expiry saved, except the gone one");
  const st2 = await readGz(store, webullDataKeys.state());
  if (regN.includes("AAPL261120C00100000")) ok(st2.jobs["option-expiry"].state.gone["2026-11-20"].includes("AAPL261120C00100000"), "gone contract remembered, not asked again");
  const bisects = client2.log.filter((c) => c.path.endsWith("/bars/list"));
  ok(bisects.some((c) => c.q.symbols === "AAPL261120C00100000"), "a 417 batch is split down to the bad symbol");
  // Tuesday: nothing left to save for Friday.
  clock.t = at("2026-11-24T21:45:00Z");
  const n0 = client2.log.length;
  pings = 0;
  do { r = await runWebullData({ client: client2, store, jobs: WEBULL_DATA_JOBS, nowFn: () => clock.t, options: opts }); clock.t += (r.waitMs || 0) + 1000; pings++; } while (r.more && pings < 200);
  ok(!client2.log.slice(n0).some((c) => c.path.endsWith("/bars/list") && c.q.symbols.includes("261120")), "saved contracts are not fetched again");
  // History keeps one summary per day.
  const st3 = await readGz(store, webullDataKeys.state());
  ok(st3.history.length >= 3 && st3.history.every((h) => h.dayKey), "daily history");
  // Export: research-kit files in the shared row shape.
  const dir = mkdtempSync(join(tmpdir(), "wb-export-"));
  const m = await exportWebullOptions({ store, outDir: dir, fromDate: "0000-00-00", toDate: "9999-99-99", symbols: null, bars: true });
  ok(m.snapshotRows > 0 && m.barRows > 0 && m.files >= 2, "export counts");
  const lines = gunzipSync(readFileSync(join(dir, "snapshots", "AAPL", "2026.jsonl.gz"))).toString("utf8").trim().split("\n").map((l) => JSON.parse(l));
  eq(Object.keys(lines[0]).slice(0, 13), ["date", "symbol", "expiry", "strike", "right", "bid", "ask", "iv", "delta", "gamma", "vega", "theta", "source"], "shared row shape first");
  ok(existsSync(join(dir, "expired-bars", "AAPL", "2026.jsonl.gz")) && existsSync(join(dir, "manifest.json")), "bars + manifest written");
}

// --- the per-minute cap holds under load -------------------------------------------------
{
  const clock = { t: at("2026-11-19T21:40:00Z") };
  const times = [];
  let planned = false;
  const store = fakeStore();
  const busy = { id: "busy", switchKey: "X", group: "g",
    plan: async () => planned ? [] : (planned = true, Array.from({ length: 60 }, (_, i) => ({ i }))),
    run: async () => { clock.t += 200; times.push(clock.t); return []; }, save: async () => null };
  let r, pings = 0, waited = 0;
  do { r = await runWebullData({ client: {}, store, jobs: [busy], nowFn: () => clock.t }); pings++; if (r.waitMs) { waited++; clock.t += r.waitMs; } } while (r.more && pings < 20);
  eq(times.length, 60, "all 60 calls made across pings");
  ok(waited >= 2 && pings >= 3, "pings return a wait when the group is at its cap");
  for (let i = 0; i < times.length; i++) ok(times.filter((t) => t > times[i] - 60000 && t <= times[i]).length <= DEFAULT_RPM, "never more than 24 a minute");
}

// --- switches ------------------------------------------------------------------------------
{
  const clock = { t: at("2026-11-19T21:40:00Z") };
  const store = fakeStore();
  const client = fakeWebull({ clock });
  const r = await runWebullData({ client, store, jobs: WEBULL_DATA_JOBS, nowFn: () => clock.t, options: { tickers: ["AAPL"] }, switchOn: (k) => k === "WEBULL_DATA" });
  eq([r.more, client.log.length], [false, 0], "every job switch off: no calls");
}

// --- rate limit answer ---------------------------------------------------------------------
{
  const rate = {};
  const lim = makeLimiter(rate, () => 2);
  lim.record("g", 0); lim.record("g", 1000);
  eq(lim.waitMs("g", 2000), 58000, "cap reached: wait for the oldest call to age out");
  lim.cool("g", 2000);
  eq(lim.waitMs("g", 3000), 59000, "429 cools the group");
  eq(lim.waitMs(null, 0), 0, "local work never waits");
  const clock = { t: at("2026-11-19T21:40:00Z") };
  let n = 0;
  const client = { get: async () => { clock.t += 100; n++; if (n === 1) throw new WebullError("too many", { status: 429 }); return [{ symbol: "AAPL", price: "100" }]; } };
  const r = await runWebullData({ client, store: fakeStore(), jobs: WEBULL_DATA_JOBS.filter((j) => j.id === "option-snapshots"), nowFn: () => clock.t, options: { tickers: ["AAPL"] }, budgetMs: 5000 });
  ok(r.more && r.counts["rate-limited"] === 1, "a 429 is retried after the cool-down, not dropped");
}

// --- tokens and routing --------------------------------------------------------------------
ok(webullDataTriggerToken("s") !== mirrorTriggerToken("s") && webullDataTriggerToken("s").length === 64, "own bearer label");
eq(routeRun({ eventName: "workflow_dispatch" }).run, true, "manual run");
eq(routeRun({ eventName: "schedule", schedule: "40 21 * * 1-5", nowMs: at("2026-11-19T21:41:00Z") }).run, true, "EST slot runs in November");
eq(routeRun({ eventName: "schedule", schedule: "40 20 * * 1-5", nowMs: at("2026-11-19T20:41:00Z") }).run, false, "EDT slot no-ops in November");
eq(routeRun({ eventName: "schedule", schedule: "40 20 * * 1-5", nowMs: at("2026-07-15T20:41:00Z") }).run, true, "EDT slot runs in July");
eq(routeRun({ eventName: "schedule", schedule: "40 21 * * 1-5", nowMs: at("2026-11-26T21:41:00Z") }).run, false, "Thanksgiving skipped");
eq(routeRun({ eventName: "schedule", schedule: "40 21 * * 1-5", nowMs: at("2026-11-20T03:30:00Z") }).run, true, "a late start after midnight ET keeps its session");

// --- the trigger log prints every count a job records -------------------------------
{
  const dir = new URL("../lib/webull-data/", import.meta.url);
  const files = ["runner.mjs", ...readdirSync(new URL("jobs/", dir)).map((f) => "jobs/" + f)].filter((f) => f.endsWith(".mjs"));
  const used = new Set();
  for (const f of files) for (const m of readFileSync(new URL(f, dir), "utf8").matchAll(/count\((?:ctx, )?"([a-z0-9-]+)"/g)) used.add(m[1]);
  const missing = [...used].filter((k) => !TRIGGER_LABELS.includes(k));
  ok(used.size >= 10, "found the jobs' count labels");
  eq(missing, [], "every job count label is printed by the trigger log");
}

console.log(`webull-data smoke: ${checks} checks passed`);

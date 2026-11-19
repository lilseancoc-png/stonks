// Daily option snapshot job (build B, 2026-11-19, docs/webull-data.md).
//
// For every covered name and the engine funds: Webull's real-time stock
// snapshot for spot, the option contract list within the strike band, then
// the snapshot (bid, ask, sizes, last, volume, open interest, IV, Greeks,
// Webull's delay and quote time) of the contracts nearest the money in the
// expiry window, up to a daily budget split evenly across names, plus every
// contract an open Top Picks or engine trade holds. One object per name per
// day under _stonks/webull-data/v1/options/snapshots/<date>/<SYM>.json.gz.
// Every saved contract joins the registry (one object per expiry date) that
// the expiry saver (option-expiry.mjs) reads after the contract expires.
//
// First run only (state.backfillDone unset): also save the bars of contracts
// that expired in the last ~8 days and may still answer, building their OCC
// symbols from today's chain strikes, and register this week's soon-to-expire
// contracts (under the 7-day window) so the expiry saver gets them too.
import {
  STOCK_SNAPSHOT_PATH, OPTION_CONTRACTS_PATH, OPTION_SNAPSHOT_PATH, SNAPSHOT_BATCH, STOCK_BATCH, DEFAULTS,
  chainRow, selectContracts, chunk, snapshotRow, rowsOf, occSymbol, parseOcc, daysBetween,
} from "../options.mjs";
import { runBars, saveBars } from "../bars.mjs";
import { webullDataKeys, readGz, writeGz } from "../store.mjs";
import { DAILY_EXPIRY_UNDERLYINGS } from "../universe.mjs";
import { sessionForDate, previousTradingDate } from "../../us-equity-calendar.mjs";
import { mirrorLegs } from "../../webull-mirror.mjs";

const num = (v) => { const n = Number(v); return v == null || v === "" || !Number.isFinite(n) ? null : n; };

// Settings from ctx.options (the action reads env), else the defaults.
export function settingsOf(options = {}) {
  const pick = (k, lo, hi) => { const n = num(options[k]); return n != null && n >= lo && n <= hi ? n : DEFAULTS[k]; };
  return { strikeBand: pick("strikeBand", 0.02, 0.6), minDte: pick("minDte", 0, 60), maxDte: pick("maxDte", 30, 1200),
    maxContracts: pick("maxContracts", 20, 40000), backfillDays: pick("backfillDays", 1, 14), backfillStrikes: pick("backfillStrikes", 1, 40) };
}

// OCC symbols the open Top Picks and engine trades hold, by underlying.
export async function heldContracts(store) {
  const out = {};
  for (const key of ["picks-accuracy.json", "engines-record.json"]) {
    let doc = null;
    try { const b = await store.get(key); doc = b == null ? null : JSON.parse(b.toString("utf8")); } catch { doc = null; }
    for (const e of Array.isArray(doc?.open) ? doc.open : []) {
      const sym = String(e?.symbol || "").toUpperCase();
      let legs = null;
      try { legs = mirrorLegs(e); } catch { legs = null; }
      for (const l of legs || []) {
        const occ = occSymbol(sym, l.expiry, l.type === "PUT" ? "P" : "C", l.strike);
        if (occ) (out[sym] || (out[sym] = [])).includes(occ) || out[sym].push(occ);
      }
    }
  }
  return out;
}

// Session dates in the backfill window before `date` on which `sym` may have
// had an expiry: every session for the daily-expiry funds, else Fridays (or
// the last session of the week when the Friday is closed).
export function backfillDates(sym, date, days) {
  const out = [];
  let d = previousTradingDate(date);
  while (d && daysBetween(d, date) <= days) {
    const dow = new Date(d + "T12:00:00Z").getUTCDay();
    const next = new Date(d + "T12:00:00Z"); next.setUTCDate(next.getUTCDate() + 1);
    const nextKey = next.toISOString().slice(0, 10);
    const weekEnd = dow === 5 || (dow === 4 && sessionForDate(nextKey)?.open === false);
    if (DAILY_EXPIRY_UNDERLYINGS.includes(sym) || weekEnd) out.push(d);
    d = previousTradingDate(d);
  }
  return out;
}

const job = {
  id: "option-snapshots",
  switchKey: "WEBULL_OPTION_SAVER",
  group: "option-snapshot",

  async plan(state, ctx) {
    const key = `${ctx.date}:${ctx.phase}`;
    if (!state.day || state.day.key !== key) {
      state.day = { key, step: "spot", spots: {}, chain: {}, rows: {}, pending: {}, reg: {}, quota: 0, held: {}, backfill: false };
    }
    const day = state.day, opt = settingsOf(ctx.options);
    if (day.step === "spot") {
      day.step = "chains";
      const funds = ctx.tickers.filter((s) => ctx.funds.includes(s));
      const stocks = ctx.tickers.filter((s) => !ctx.funds.includes(s));
      return [
        ...chunk(stocks, STOCK_BATCH).map((symbols) => ({ kind: "spot", category: "US_STOCK", symbols, group: "stock-snapshot" })),
        ...chunk(funds, STOCK_BATCH).map((symbols) => ({ kind: "spot", category: "US_ETF", symbols, group: "stock-snapshot" })),
      ];
    }
    if (day.step === "chains") {
      day.step = "flush";
      day.held = await heldContracts(ctx.store);
      const names = ctx.tickers.filter((s) => day.spots[s]?.price > 0);
      ctx.count("spot-missing", ctx.tickers.length - names.length);
      day.quota = Math.floor(opt.maxContracts / Math.max(1, names.length));
      day.backfill = ctx.options.backfill === "1" || (!state.backfillDone && ctx.options.backfill !== "0");
      return names.map((sym) => {
        const S = day.spots[sym].price;
        return { kind: "chain", sym, group: "option-contracts",
          gte: (S * (1 - opt.strikeBand)).toFixed(2), lte: (S * (1 + opt.strikeBand)).toFixed(2) };
      });
    }
    if (day.step === "flush") {
      day.step = "done";
      return Object.keys(day.reg).sort().map((expiry) => ({ kind: "reg", expiry, group: null }));
    }
    if (day.step === "done" && day.backfill && !state.backfillDone) state.backfillDone = ctx.date;
    return [];
  },

  async run(item, client, ctx) {
    if (item.kind === "spot") {
      const rows = rowsOf(await client.get(STOCK_SNAPSHOT_PATH, { category: item.category, symbols: item.symbols.join(",") }));
      const got = new Set(rows.map((r) => String(r?.symbol || "").toUpperCase()));
      const missing = item.symbols.filter((s) => !got.has(s));
      // A name in the other category is asked once more there.
      const more = !item.retry && missing.length ? [{ ...item, symbols: missing, category: item.category === "US_STOCK" ? "US_ETF" : "US_STOCK", retry: true, attempts: 0 }] : [];
      return { records: { kind: "spot", rows }, more };
    }
    if (item.kind === "chain") {
      const body = await client.get(OPTION_CONTRACTS_PATH, { category: "US_OPTION", underlying_symbols: item.sym,
        strike_price_gte: item.gte, strike_price_lte: item.lte, pagination_key: item.page || null });
      const next = body && typeof body === "object" && !Array.isArray(body) ? body.pagination_key : null;
      const rows = rowsOf(body);
      return { records: { kind: "chain", sym: item.sym, rows, last: !next || !rows.length },
        more: next && rows.length ? [{ ...item, page: String(next), attempts: 0 }] : [] };
    }
    if (item.kind === "snap") {
      const rows = rowsOf(await client.get(OPTION_SNAPSHOT_PATH, { category: "US_OPTION", symbols: item.symbols.join(",") }));
      return { records: { kind: "snap", sym: item.sym, rows, asked: item.symbols.length } };
    }
    if (item.kind === "probe" || item.kind === "bars") {
      const out = await runBars(item, client);
      return out;
    }
    if (item.kind === "reg") return { records: { kind: "reg", expiry: item.expiry } };
    return { records: null };
  },

  async save(records, store, ctx) {
    const state = ctx.state;
    const day = state.day, opt = settingsOf(ctx.options);
    if (!records) return null;
    if (records.kind === "spot") {
      for (const r of records.rows) {
        const sym = String(r?.symbol || "").toUpperCase(), price = num(r?.price) ?? num(r?.close) ?? num(r?.pre_close);
        if (sym && price > 0) day.spots[sym] = { price, t: num(r.quote_time) ?? num(r.last_trade_time) };
      }
      return null;
    }
    if (records.kind === "chain") {
      const acc = day.chain[records.sym] || (day.chain[records.sym] = []);
      for (const c of records.rows) { const row = chainRow(c); if (row) acc.push(row); }
      ctx.count("chain-contracts", records.rows.length);
      if (!records.last) return null;
      const chain = day.chain[records.sym];
      delete day.chain[records.sym];
      return { more: afterChain(records.sym, chain, day, state, ctx, opt) };
    }
    if (records.kind === "snap") {
      const list = day.rows[records.sym] || (day.rows[records.sym] = []);
      const spot = day.spots[records.sym]?.price ?? null;
      for (const r of records.rows) { const row = snapshotRow(r, { date: ctx.date, underlying: records.sym, spot }); if (row) list.push(row); }
      ctx.count("snapshot-missing", Math.max(0, records.asked - records.rows.length));
      day.pending[records.sym] = (day.pending[records.sym] || 1) - 1;
      if (day.pending[records.sym] > 0) return null;
      delete day.pending[records.sym];
      await writeSnapshot(records.sym, day, store, ctx);
      return null;
    }
    if (records.kind === "bars") {
      const { saved } = await saveBars(records, store, ctx);
      // A probe that answered opens the rest of that expiry's strikes.
      const item = records.item || {};
      if (item.kind === "probe") {
        if (saved.length) return { more: chunk(item.rest || [], SNAPSHOT_BATCH).map((symbols) => ({ kind: "bars", symbols, group: "option-bars" })) };
        ctx.count("backfill-none");
      }
      return null;
    }
    if (records.kind === "reg") {
      const add = day.reg[records.expiry] || {};
      delete day.reg[records.expiry];
      const key = webullDataKeys.registry(records.expiry);
      const doc = (await readGz(store, key)) || { v: 1, expiry: records.expiry, contracts: {} };
      for (const [occ, e] of Object.entries(add)) {
        const prev = doc.contracts[occ];
        doc.contracts[occ] = { u: e.u, m: e.m, first: prev?.first || ctx.date, last: ctx.date };
      }
      await writeGz(store, key, doc);
      ctx.count("registry-writes");
      return null;
    }
    return null;
  },
};

function afterChain(sym, chain, day, state, ctx, opt) {
  const spot = day.spots[sym]?.price;
  const held = day.held[sym] || [];
  const picked = selectContracts(chain, { spot, date: ctx.date, quota: day.quota, held, strikeBand: opt.strikeBand, minDte: opt.minDte, maxDte: opt.maxDte });
  // A held contract outside the chain we fetched (strike outside the band)
  // is still snapshotted: its symbol is enough.
  const have = new Set(picked.map((c) => c.s));
  const symbols = [...picked.map((c) => c.s), ...held.filter((s) => !have.has(s) && parseOcc(s) && daysBetween(ctx.date, parseOcc(s).expiry) >= 0)];
  for (const c of picked) addReg(day, c.s, sym, c.m);
  for (const s of symbols) if (!have.has(s)) addReg(day, s, sym, null);
  const more = [];
  const chunks = chunk(symbols, SNAPSHOT_BATCH);
  if (chunks.length) day.pending[sym] = chunks.length;
  for (const c of chunks) more.push({ kind: "snap", sym, symbols: c, group: "option-snapshot" });
  if (!chunks.length) ctx.count("snapshot-empty");
  if (day.backfill) {
    // This week's contracts under the snapshot window join the registry so
    // the expiry saver keeps them (they were never snapshotted at 7+ days).
    const near = selectContracts(chain.filter((c) => daysBetween(ctx.date, c.e) >= 0 && daysBetween(ctx.date, c.e) < opt.minDte),
      { spot, date: ctx.date, quota: opt.backfillStrikes * 4 * 5, strikeBand: opt.strikeBand, minDte: 0, maxDte: opt.minDte });
    for (const c of near) addReg(day, c.s, sym, c.m);
    // Recently expired contracts: strikes nearest spot on the nearest live
    // expiry, rebuilt as OCC symbols on each possible past expiry date. One
    // at-the-money probe per date first; only an answer opens the rest.
    const live = chain.filter((c) => daysBetween(ctx.date, c.e) >= 0).sort((a, b) => a.e.localeCompare(b.e));
    const first = live[0]?.e;
    const strikes = [...new Set(live.filter((c) => c.e === first).map((c) => c.k))].sort((a, b) => Math.abs(a - spot) - Math.abs(b - spot)).slice(0, opt.backfillStrikes * 2);
    if (strikes.length) {
      for (const d of backfillDates(sym, ctx.date, opt.backfillDays)) {
        const syms = [];
        for (const k of strikes) for (const r of ["C", "P"]) { const s = occSymbol(sym, d, r, k); if (s) syms.push(s); }
        if (!syms.length) continue;
        more.push({ kind: "probe", symbols: [syms[0]], rest: syms.slice(1), group: "option-bars" });
      }
    }
  }
  return more;
}

function addReg(day, occ, u, m) {
  const p = parseOcc(occ);
  if (!p) return;
  const e = day.reg[p.expiry] || (day.reg[p.expiry] = {});
  e[occ] = { u, m: m == null ? null : Math.round(m * 10000) / 10000 };
}

async function writeSnapshot(sym, day, store, ctx) {
  const rows = day.rows[sym] || [];
  delete day.rows[sym];
  const newest = rows.reduce((a, r) => Math.max(a, r.quote_time ? Date.parse(r.quote_time) : 0), 0) || null;
  for (const r of rows) r.stale = !!(newest && r.quote_time && newest - Date.parse(r.quote_time) > 30 * 60000);
  rows.sort((a, b) => a.expiry.localeCompare(b.expiry) || a.strike - b.strike || a.right.localeCompare(b.right));
  const spot = day.spots[sym] || {};
  const doc = { v: 1, date: ctx.date, phase: ctx.phase, underlying: sym, spot: spot.price ?? null,
    spotTime: spot.t ? new Date(spot.t).toISOString() : null, takenAtIso: new Date(ctx.nowMs).toISOString(),
    delayMin: rows.find((r) => r.delay_min != null)?.delay_min ?? null, count: rows.length, rows };
  const bytes = await writeGz(store, webullDataKeys.snapshot(ctx.date, sym), doc);
  ctx.count("snapshot-names");
  ctx.count("snapshot-contracts", rows.length);
  ctx.count("snapshot-wide", rows.filter((r) => r.wide).length);
  ctx.count("snapshot-stale", rows.filter((r) => r.stale).length);
  ctx.count("bytes", bytes);
}

export default job;

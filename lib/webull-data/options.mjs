// Pure helpers for the Webull option price saver (2026-11-19, docs/webull-data.md).
// No network, no store: OCC symbols, which contracts to save, and the row
// shapes we keep. Field names are Webull's own, as returned on the paper keys
// by the 2026-11-19 probe (/mnt/project-files/webull-data/probe-2026-11-19/):
//   option contracts  GET /trading/instruments/options/contracts/list
//     { data: [{ symbol, expiration_date, option_type, strike_price,
//       tradable_status, def_type, root_symbol, underlying_symbol, multiplier,
//       expired_cycle, ppind, ... }], pagination_key }  (pages of 1,000)
//   option snapshots  GET /market-data/options/snapshots/list (20 symbols)
//     [{ symbol, price, open, high, low, close, pre_close, volume, change,
//       change_ratio, bid, ask, bid_size, ask_size, imp_vol, delta, gamma,
//       theta, vega, rho, open_interest, strike_price, instrument_id,
//       last_trade_time (ms), quote_time (ms), deal_amount, delay_minutes }]
//   option bars       GET /market-data/options/bars/list (D, count 1200)
//     [{ symbol, instrument_id, delay_minutes, result: [{ time, open, high,
//       low, close, volume }] }]  newest first; daily bars stamped at ET midnight
//   stock snapshots   GET /market-data/stocks/snapshots/list (100 symbols)
//     [{ symbol, price, quote_time, last_trade_time, ... }]
// Numbers arrive as strings; they are parsed here and kept as numbers.

export const OPTION_SNAPSHOT_PATH = "/market-data/options/snapshots/list";
export const OPTION_BARS_PATH = "/market-data/options/bars/list";
export const OPTION_CONTRACTS_PATH = "/trading/instruments/options/contracts/list";
export const STOCK_SNAPSHOT_PATH = "/market-data/stocks/snapshots/list";
export const SNAPSHOT_BATCH = 20; // Webull: up to 20 option symbols per snapshot / bars call
export const STOCK_BATCH = 100;   // Webull: up to 100 symbols per stock snapshot call
export const BARS_COUNT = 1200;   // Webull: at most 1,200 bars per call

// Defaults (each overridable by env in the action, see docs/webull-data.md).
export const DEFAULTS = Object.freeze({
  strikeBand: 0.20,      // strikes within 20% of spot
  minDte: 7,             // expiries 7 to 400 days out
  maxDte: 400,
  maxContracts: 12000,   // snapshot budget per day (600 calls at 20 a call)
  expirySessions: 5,     // save an expired contract's bars 1 to 5 sessions after expiry
  backfillDays: 8,       // first run: try contracts that expired in the last 8 calendar days
  backfillStrikes: 8,    // first run: strikes each side of spot per expired date
});

const num = (v) => {
  if (v == null || v === "" || typeof v === "boolean") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// OCC option symbol: root (1-6 letters), YYMMDD, C or P, strike x 1000 in 8
// digits. e.g. AAPL270115C00350000 = AAPL, 2027-01-15, call, 350.
// (OCC Symbology Initiative, 2010; the same form Webull uses in `symbol`.)
const OCC_RE = /^([A-Z][A-Z0-9.]{0,5})(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/;
export function parseOcc(sym) {
  const m = OCC_RE.exec(String(sym || "").trim().toUpperCase());
  if (!m) return null;
  const [, root, yy, mm, dd, cp, k] = m;
  const expiry = `20${yy}-${mm}-${dd}`;
  const d = new Date(expiry + "T12:00:00Z");
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== expiry) return null;
  return { root, expiry, right: cp, strike: Number(k) / 1000 };
}
export function occSymbol(root, expiry, right, strike) {
  const r = String(root || "").toUpperCase();
  const k = Math.round(Number(strike) * 1000);
  if (!/^[A-Z][A-Z0-9.]{0,5}$/.test(r) || !/^\d{4}-\d{2}-\d{2}$/.test(expiry || "") || !["C", "P"].includes(right) || !(k > 0) || k > 99999999) return null;
  return `${r}${expiry.slice(2, 4)}${expiry.slice(5, 7)}${expiry.slice(8, 10)}${right}${String(k).padStart(8, "0")}`;
}

// Calendar days from a YYYY-MM-DD date to another.
export function daysBetween(from, to) {
  return Math.round((Date.parse(to + "T12:00:00Z") - Date.parse(from + "T12:00:00Z")) / 86400000);
}

// A contract row from the contract list, cut to what we keep. Null for
// anything we would not trade or price: non-standard (adjusted after a
// corporate action: root differs from the underlying, or def_type is not
// STANDARD), not 100 shares, unknown type or strike, non-tradable (NT).
export function chainRow(c) {
  if (!c || typeof c !== "object") return null;
  const occ = parseOcc(c.symbol);
  const strike = num(c.strike_price);
  const type = String(c.option_type || "").toUpperCase();
  if (!occ || strike == null || !["CALL", "PUT"].includes(type)) return null;
  if (c.def_type && String(c.def_type).toUpperCase() !== "STANDARD") return null;
  if (c.root_symbol && c.underlying_symbol && String(c.root_symbol) !== String(c.underlying_symbol)) return null;
  const mult = num(c.multiplier);
  if (mult != null && Math.abs(mult - 100) > 1e-6) return null;
  if (String(c.tradable_status || "").toUpperCase() === "NT") return null;
  return { s: String(c.symbol).trim().toUpperCase(), e: c.expiration_date || occ.expiry, k: strike, t: type === "CALL" ? "C" : "P",
    cy: c.expired_cycle || null, pp: c.ppind === true ? 1 : c.ppind === false ? 0 : null };
}

// Which contracts to snapshot for one underlying today. Within the strike
// band and the expiry window, nearest the money first, where "near" is
// measured in rough standard moves: |ln(K/S)| / sqrt(T), so a 3-week
// expiry keeps tighter strikes than a 1-year one. `quota` caps the count;
// `held` (OCC symbols an open trade holds) are always kept, band or not.
export function selectContracts(chain, { spot, date, quota, held = [], strikeBand = DEFAULTS.strikeBand, minDte = DEFAULTS.minDte, maxDte = DEFAULTS.maxDte } = {}) {
  const S = num(spot);
  const heldSet = new Set(held);
  const keep = [], seen = new Set();
  for (const c of chain || []) if (heldSet.has(c.s) && daysBetween(date, c.e) >= 0 && !seen.has(c.s)) { keep.push({ ...c, m: S ? Math.abs(Math.log(c.k / S)) : null, held: true }); seen.add(c.s); }
  if (!(S > 0)) return keep;
  const scored = [];
  for (const c of chain || []) {
    if (seen.has(c.s)) continue;
    const dte = daysBetween(date, c.e);
    if (dte < minDte || dte > maxDte) continue;
    if (!(c.k > 0) || Math.abs(c.k / S - 1) > strikeBand) continue;
    const m = Math.abs(Math.log(c.k / S));
    scored.push({ ...c, m, z: m / Math.sqrt(Math.max(dte, 7) / 365) });
  }
  scored.sort((a, b) => a.z - b.z || a.e.localeCompare(b.e) || a.k - b.k || a.t.localeCompare(b.t));
  for (const c of scored.slice(0, Math.max(0, quota | 0))) { delete c.z; keep.push(c); }
  return keep;
}

// Split a list into chunks of n.
export function chunk(list, n) {
  const out = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}

const iso = (ms) => { const n = num(ms); return n && n > 0 ? new Date(n).toISOString() : null; };

// One option snapshot row as we save it (the shared research row shape,
// agreed with the DoltHub history pull: date, symbol, expiry, strike, right,
// bid, ask, iv, delta, gamma, vega, theta, plus Webull's extras).
// `wide`: no two-sided market, or the spread is more than half the mid.
// `stale`: the quote is 30+ minutes older than the newest quote in the run
// (thin names can sit frozen; the probe saw FTNT unchanged for 12 minutes).
export function snapshotRow(r, { date, underlying, spot, newestQuoteMs = null } = {}) {
  const occ = parseOcc(r?.symbol);
  if (!occ) return null;
  const bid = num(r.bid), ask = num(r.ask);
  const mid = bid != null && ask != null && bid > 0 && ask >= bid ? (bid + ask) / 2 : null;
  const q = num(r.quote_time);
  return {
    date, symbol: r.symbol, underlying: underlying || occ.root, expiry: occ.expiry, strike: num(r.strike_price) ?? occ.strike, right: occ.right,
    bid, ask, bid_size: num(r.bid_size), ask_size: num(r.ask_size), last: num(r.price),
    open: num(r.open), high: num(r.high), low: num(r.low), close: num(r.close), pre_close: num(r.pre_close),
    volume: num(r.volume), oi: num(r.open_interest), iv: num(r.imp_vol),
    delta: num(r.delta), gamma: num(r.gamma), theta: num(r.theta), vega: num(r.vega), rho: num(r.rho),
    spot: num(spot), quote_time: iso(q), last_trade_time: iso(r.last_trade_time),
    delay_min: num(r.delay_minutes), instrument_id: r.instrument_id != null ? String(r.instrument_id) : null,
    wide: mid == null || (ask - bid) / mid > 0.5,
    stale: q != null && newestQuoteMs != null && newestQuoteMs - q > 30 * 60000,
    source: "webull",
  };
}

// ET calendar date of a Webull daily bar ("2026-11-18T05:00:00.000+0000" is
// midnight ET on Nov 18). Daily bars are stamped at ET midnight, so the ET
// date is the session.
const ET_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
export function barDate(time) {
  const t = Date.parse(String(time || "").replace(/\+0000$/, "Z"));
  return Number.isFinite(t) ? ET_DATE.format(new Date(t)) : null;
}

// The bars response for one call, as { symbol -> sorted daily bars }. Webull
// returns a list of { symbol, instrument_id, delay_minutes, result } (the
// docs also describe an object with `result`; both are read).
export function barsBySymbol(body) {
  const list = Array.isArray(body) ? body : Array.isArray(body?.result) ? body.result : Array.isArray(body?.data) ? body.data : [];
  const out = new Map();
  for (const item of list) {
    if (!item || !item.symbol) continue;
    const bars = (Array.isArray(item.result) ? item.result : []).map((b) => ({
      date: barDate(b.time), open: num(b.open), high: num(b.high), low: num(b.low), close: num(b.close), volume: num(b.volume),
    })).filter((b) => b.date).sort((a, b) => a.date.localeCompare(b.date));
    out.set(String(item.symbol), { bars, instrument_id: item.instrument_id != null ? String(item.instrument_id) : null, delay_min: num(item.delay_minutes) });
  }
  return out;
}

// A list response's rows (`data` for the contract list, a bare list for the
// snapshot endpoints).
export const rowsOf = (body) => Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : [];

// A Webull "invalid symbol" answer (HTTP 417 INVALID_SYMBOL): an expired
// contract whose history Webull has deleted, or a symbol that never listed.
export const isInvalidSymbol = (err) => err?.code === "INVALID_SYMBOL" || (err?.status === 417 && /invalid symbol/i.test(String(err?.message || "")));

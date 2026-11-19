// Real option price history for research (2026-11-19, owner request).
//
// Source: DoltHub's post-no-preference/options database (option_chain table:
// daily end-of-day bid, ask, implied volatility and greeks for about 2,300
// US stocks and funds since 2019). It is free and keyless; the database
// states no license, so it is used for personal research only, and only
// aggregates (never a price row) are ever committed or shown on the site.
//
// The rows are written in the shared option-history shape agreed with the
// Webull option-price saver (engine roadmap wave 2), so the two sources can
// be read by the same code:
//   { date, symbol, underlying, expiry, strike, right, bid, ask, iv, delta,
//     gamma, vega, theta, source }
//   date / expiry  YYYY-MM-DD; symbol the OCC symbol without padding
//   (AAPL261218C00150000); right "C" | "P"; iv a decimal (0.32 = 32%);
//   any optional number may be null.
// Files: <dir>/<UNDERLYING>/<YEAR>.jsonl.gz, one row per line, by trade date.
//
// Nothing here runs in the bake. Pure helpers are exported for the offline
// smoke test (scripts/option-history-smoke.mjs).
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

export const DOLTHUB_API = "https://www.dolthub.com/api/v1alpha1/post-no-preference/options/master";
export const OPTION_HISTORY_SOURCE_NOTE = "DoltHub post-no-preference/options (no license stated; personal research use, aggregates only).";

const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const isoDate = (v) => {
  if (v == null || v === "") return null;
  const s = String(v).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : null;
};

// OCC symbol, unpadded: ROOT + YYMMDD + C/P + strike x 1000 in 8 digits.
export function occSymbol(underlying, expiryIso, right, strike) {
  const root = String(underlying || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(expiryIso || ""));
  const k = Math.round(Number(strike) * 1000);
  if (!root || !m || !(k > 0) || !/^[CP]$/.test(right)) return null;
  return `${root}${m[1].slice(2)}${m[2]}${m[3]}${right}${String(k).padStart(8, "0")}`;
}

export function rightOf(v) {
  const s = String(v ?? "").trim().toUpperCase();
  if (s === "C" || s === "CALL" || s === "CALLS") return "C";
  if (s === "P" || s === "PUT" || s === "PUTS") return "P";
  return null;
}

// One DoltHub row (column names vary a little between table versions) to the
// shared shape, or null when a required field is missing or the quote is
// impossible (ask below bid, no positive price at all).
export function normalizeDoltRow(r) {
  if (!r || typeof r !== "object") return null;
  const date = isoDate(r.date ?? r.quote_date ?? r.trade_date);
  const underlying = String(r.act_symbol ?? r.symbol ?? r.underlying ?? "").trim().toUpperCase();
  const expiry = isoDate(r.expiration ?? r.expiry ?? r.expiration_date);
  const strike = num(r.strike ?? r.strike_price);
  const right = rightOf(r.call_put ?? r.right ?? r.type ?? r.option_type);
  if (!date || !underlying || !expiry || !(strike > 0) || !right || expiry < date) return null;
  const bid = num(r.bid), ask = num(r.ask);
  if (bid == null && ask == null) return null;
  if (bid != null && ask != null && ask < bid) return null;
  if (!((ask ?? 0) > 0 || (bid ?? 0) > 0)) return null;
  let iv = num(r.vol ?? r.iv ?? r.implied_volatility);
  if (iv != null && iv > 5) iv = iv / 100;   // a percentage, not a decimal
  return {
    date, symbol: occSymbol(underlying, expiry, right, strike), underlying, expiry, strike, right,
    bid, ask, iv, delta: num(r.delta), gamma: num(r.gamma), vega: num(r.vega), theta: num(r.theta), source: "dolthub",
  };
}

// DoltHub SQL API answer: { query_execution_status, query_execution_message,
// schema, rows: [{ col: value }] }. Returns { rows, ok, message, truncated }.
export function parseDoltApi(body) {
  let j = body;
  if (typeof body === "string") { try { j = JSON.parse(body); } catch { return { rows: [], ok: false, message: "not JSON", truncated: false }; } }
  const status = String(j?.query_execution_status || "").toLowerCase();
  const rows = Array.isArray(j?.rows) ? j.rows : [];
  const ok = status === "success" || status === "rowlimit" || (!status && Array.isArray(j?.rows));
  return { rows, ok, message: j?.query_execution_message || null, truncated: status === "rowlimit" };
}

export function doltQueryUrl(sql) {
  return `${DOLTHUB_API}?q=${encodeURIComponent(sql)}`;
}

// Read every row of one underlying and year from a history folder. Returns a
// Map date -> [row]. A missing file is an empty map.
export function readYear(dir, underlying, year) {
  const file = path.join(dir, String(underlying).toUpperCase(), `${year}.jsonl.gz`);
  const out = new Map();
  if (!fs.existsSync(file)) return out;
  const text = zlib.gunzipSync(fs.readFileSync(file)).toString("utf8");
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let r;
    try { r = JSON.parse(line); } catch { continue; }
    if (!r?.date) continue;
    if (!out.has(r.date)) out.set(r.date, []);
    out.get(r.date).push(r);
  }
  return out;
}

// Merge rows into the folder: one file per underlying and year, rows keyed by
// date + OCC symbol (a later row replaces an earlier one for the same key),
// sorted by date then symbol. Returns the number of rows written.
export function writeRows(dir, rows) {
  const groups = new Map();
  for (const r of rows) {
    if (!r?.underlying || !r.date || !r.symbol) continue;
    const k = `${r.underlying}|${r.date.slice(0, 4)}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  let written = 0;
  for (const [k, list] of groups) {
    const [u, y] = k.split("|");
    const prior = readYear(dir, u, y);
    const byKey = new Map();
    for (const rs of prior.values()) for (const r of rs) byKey.set(`${r.date}|${r.symbol}`, r);
    for (const r of list) byKey.set(`${r.date}|${r.symbol}`, r);
    const all = [...byKey.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0));
    const file = path.join(dir, u, `${y}.jsonl.gz`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, zlib.gzipSync(all.map((r) => JSON.stringify(r)).join("\n") + "\n"));
    written += all.length;
  }
  return written;
}

// A reader over a history folder with a per-(underlying, year) cache:
// rowsOn(underlying, date) -> [row] for that trade date (empty when none).
export function historyReader(dir) {
  const cache = new Map();
  const year = (u, y) => {
    const k = `${u}|${y}`;
    if (!cache.has(k)) cache.set(k, readYear(dir, u, y));
    return cache.get(k);
  };
  return {
    rowsOn: (underlying, date) => year(String(underlying).toUpperCase(), String(date).slice(0, 4)).get(date) || [],
    datesFor: (underlying, fromIso, toIso) => {
      const u = String(underlying).toUpperCase(), out = [];
      for (let y = Number(fromIso.slice(0, 4)); y <= Number(toIso.slice(0, 4)); y++) {
        for (const d of year(u, String(y)).keys()) if (d >= fromIso && d <= toIso) out.push(d);
      }
      return out.sort();
    },
  };
}

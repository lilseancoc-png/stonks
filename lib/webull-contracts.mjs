// Webull contract check for the paper mirror (2026-11-19, wave 2 build A).
//
// Before the first entry order of an option trade, the mirror looks each leg
// up in Webull's own option contract list (official OpenAPI, trading group:
// GET /trading/instruments/options/contracts/list,
// developer.webull.com/apis/docs/reference/option-contract-list). A contract
// Webull does not list, or lists as anything but tradable, gets no order and
// is logged as a missed entry: "Not tradable at Webull: ...". Exits are never
// held back here (a position already open must always be closable).
//
// Fields used, all from that page and seen live by the 2026-11-19 paper-key
// probe (/mnt/project-files/webull-data/probe-2026-11-19/report.md):
//   symbol           OCC symbol, e.g. "AAPL261218P00350000"
//   tradable_status  OC = open and close, CO = close only, NT = not tradable
//   expiration_date  YYYY-MM-DD, option_type CALL / PUT, strike_price
//   multiplier       "100" for a standard equity option
//   def_type         STANDARD / BINARY / FLEX
//   ppind            Penny Pilot (Penny Interval Program) flag
//
// Price step. The Penny Interval Program class trades $0.01 under $3.00 and
// $0.05 at $3.00 and up; a class outside it trades the standard $0.05 under
// $3.00 and $0.10 at $3.00 and up (Cboe, "Penny Interval Program",
// 2022-12-21: cdn.cboe.com/resources/product_update/2022/Penny-Interval-Program_122122.pdf).
// ppind true keeps the mirror's old rule; ppind false moves a single-leg
// limit to the wider step. Spreads keep $0.01 (a complex order's net price).
//
// Lookup cost: one call per run for every contract the run is about to buy
// (option_symbols takes a comma list; the probe found page size 1,000 and
// AAPL alone 3,386 contracts, so whole chains are never paged), plus one
// call per leg that the symbol lookup does not find, for that underlying's
// one expiry (an adjusted contract can carry another root symbol). A missing
// strike blocks the order only when that call returned other rows of the
// same underlying and expiry; an empty answer is "unconfirmed" and the order
// sends as before (the comma list and the date filters were not both proven
// live by the probe, so silence is never read as "not listed"). Paper keys allow 30 calls a minute
// per group; MAX_CALLS_PER_RUN keeps a run far under that.

export const CONTRACT_CHECK_VERSION = "2026-11-19-contract-list";
export const SYMBOLS_PER_CALL = 20;
export const MAX_CALLS_PER_RUN = 12;
export const NOT_TRADABLE_PREFIX = "Not tradable at Webull";

const num = (v) => { const n = Number(v); return v == null || v === "" || !Number.isFinite(n) ? null : n; };

// OCC option symbol: root (letters/digits of the underlying), YYMMDD, C or P,
// strike x 1000 as 8 digits. The probe's rows read "AAPL261218P00350000".
export function occSymbol(underlying, expiry, type, strike) {
  const root = String(underlying || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(expiry || ""));
  const k = num(strike);
  if (!root || !m || k == null || !(k > 0)) return null;
  const t = String(type || "").toUpperCase().startsWith("P") ? "P" : "C";
  const milli = Math.round(k * 1000);
  if (milli > 99999999) return null;
  return `${root}${m[1].slice(2)}${m[2]}${m[3]}${t}${String(milli).padStart(8, "0")}`;
}

// A contract-list reply -> { rows, next }. Tolerates a bare array.
export function parseContractList(resp) {
  const rows = Array.isArray(resp) ? resp : Array.isArray(resp?.data) ? resp.data : [];
  const next = !Array.isArray(resp) && resp?.pagination_key ? String(resp.pagination_key) : null;
  return { rows: rows.filter((r) => r && typeof r === "object"), next };
}

// The row for one of our legs: same OCC symbol, else the same underlying,
// expiry, type and strike (an adjusted contract keeps those).
export function matchLeg(symbol, leg, rows) {
  const occ = occSymbol(symbol, leg.expiry, leg.type, leg.strike);
  const bySymbol = rows.find((r) => String(r.symbol || "").toUpperCase() === occ);
  if (bySymbol) return bySymbol;
  const under = String(symbol || "").toUpperCase();
  return rows.find((r) => String(r.underlying_symbol || "").toUpperCase() === under && String(r.expiration_date || "") === leg.expiry &&
    String(r.option_type || "").toUpperCase() === leg.type && Math.abs((num(r.strike_price) ?? -1) - leg.strike) < 1e-6) || null;
}

// One leg's row -> null when fine for a new entry, else the reason (fixed
// words, no ticker, so it can be counted in the public log too).
export function legProblem(row) {
  if (!row) return "contract not listed";
  const ts = String(row.tradable_status || "").toUpperCase();
  if (ts === "CO") return "closing orders only";
  if (ts && ts !== "OC") return "not tradable";
  const status = String(row.status || "").toUpperCase();
  if (status && status !== "LISTING") return "being delisted";
  const def = String(row.def_type || "").toUpperCase();
  if (def && def !== "STANDARD") return "non-standard contract";
  const mult = num(row.multiplier);
  if (mult != null && mult !== 100) return "adjusted contract (not 100 shares)";
  return null;
}

// Whole-trade verdict from the rows found for its legs.
export function contractVerdict(t, rows, checkedIso = null) {
  const legs = Array.isArray(t?.legs) ? t.legs : [];
  const found = legs.map((l) => matchLeg(t.symbol, l, rows));
  const problems = found.map(legProblem);
  const bad = problems.find(Boolean) || null;
  // Every leg must carry the flag for the trade to count as penny-pilot.
  const flags = found.map((r) => (r && typeof r.ppind === "boolean" ? r.ppind : null));
  const ppind = flags.length && flags.every((f) => f === true) ? true : flags.some((f) => f === false) ? false : null;
  return {
    version: CONTRACT_CHECK_VERSION, checkedIso, ok: !bad, reason: bad,
    ppind, legs: found.map((r, i) => ({ occ: occSymbol(t.symbol, legs[i].expiry, legs[i].type, legs[i].strike), found: !!r,
      tradable: r?.tradable_status ?? null, ppind: typeof r?.ppind === "boolean" ? r.ppind : null })),
  };
}

// The option price step for a single-leg limit at this price. Penny-pilot
// (or unknown, the old rule): $0.01 under $3, $0.05 from $3. Standard:
// $0.05 under $3, $0.10 from $3. A spread's net price steps $0.01.
export function optionTick(price, { ppind = null, spread = false } = {}) {
  if (spread) return 0.01;
  const p = num(price) ?? 0;
  if (ppind === false) return p >= 3 ? 0.10 : 0.05;
  return p >= 3 ? 0.05 : 0.01;
}

// The checker the mirror calls (runWebullMirror `contractCheck`). Built once
// per run around the client; `prefetch(trades)` looks up every contract the
// run may buy in as few calls as it can, `check(t)` answers one trade.
// A failed lookup answers { ok: null } (unknown): the mirror then sends the
// order as before, under the old price step, and counts a warning.
export function makeContractCheck(client, { nowIso = () => new Date().toISOString(), maxCalls = MAX_CALLS_PER_RUN } = {}) {
  const rows = new Map(); // OCC symbol -> row (or null once looked up and missing)
  let calls = 0, failed = false, denied = false, unconfirmed = 0;
  const canCall = () => typeof client?.optionContracts === "function" && !failed && calls < maxCalls;
  async function fetchSymbols(symbols) {
    for (let i = 0; i < symbols.length; i += SYMBOLS_PER_CALL) {
      if (!canCall()) return;
      const batch = symbols.slice(i, i + SYMBOLS_PER_CALL);
      calls++;
      try {
        const { rows: got } = parseContractList(await client.optionContracts({ category: "US_OPTION", option_symbols: batch.join(",") }));
        for (const s of batch) if (!rows.has(s)) rows.set(s, null);
        for (const r of got) if (r.symbol) rows.set(String(r.symbol).toUpperCase(), r);
      } catch (err) {
        failed = true; denied = err?.status === 401 || err?.status === 403;
        if (["RUN_BUDGET", "LEASE_EXPIRED"].includes(err?.code)) throw err;
      }
    }
  }
  // A leg the symbol lookup missed: one call for the underlying's whole
  // expiry (no type or strike filter; the date and underlying filters are
  // re-checked here on every row). Answers { row, sameExpiry }: sameExpiry
  // is true only when Webull returned at least one row of this underlying
  // and expiry, which proves the query worked. Only then is a missing strike
  // "contract not listed"; an empty answer is "unconfirmed" (order sends).
  async function fetchByFields(symbol, leg) {
    if (!canCall()) return undefined;
    calls++;
    try {
      const { rows: got, next } = parseContractList(await client.optionContracts({ category: "US_OPTION", underlying_symbols: symbol,
        start_date: leg.expiry, end_date: leg.expiry }));
      const under = String(symbol || "").toUpperCase();
      const same = got.filter((r) => String(r.underlying_symbol || "").toUpperCase() === under && String(r.expiration_date || "") === leg.expiry);
      const row = matchLeg(symbol, leg, got);
      // A cut-short page that lacks our strike proves nothing either.
      return { row, sameExpiry: same.length > 0 && (row != null || !next) };
    } catch (err) {
      failed = true; denied = err?.status === 401 || err?.status === 403;
      if (["RUN_BUDGET", "LEASE_EXPIRED"].includes(err?.code)) throw err;
      return undefined;
    }
  }
  const occOf = (t, l) => occSymbol(t.symbol, l.expiry, l.type, l.strike);
  return {
    stats: () => ({ calls, failed, denied, unconfirmed }),
    async prefetch(trades) {
      const want = [];
      for (const t of trades || []) for (const l of t?.legs || []) {
        const s = occOf(t, l);
        if (s && !rows.has(s) && !want.includes(s)) want.push(s);
      }
      if (want.length) await fetchSymbols(want);
    },
    async check(t) {
      const legs = Array.isArray(t?.legs) ? t.legs : [];
      if (!legs.length) return null;
      const missing = legs.map((l) => occOf(t, l)).filter((s) => s && !rows.has(s));
      if (missing.length) await fetchSymbols(missing);
      const found = [];
      for (const l of legs) {
        const s = occOf(t, l);
        let r = s ? rows.get(s) : null;
        if (r === undefined) return { ok: null, reason: "contract list unavailable", checkedIso: nowIso() };
        if (r === null) {
          const again = await fetchByFields(t.symbol, l);
          if (again === undefined) return { ok: null, reason: "contract list unavailable", checkedIso: nowIso() };
          if (!again.row && !again.sameExpiry) { unconfirmed++; return { ok: null, reason: "contract list unconfirmed", checkedIso: nowIso() }; }
          r = again.row;
          if (r) rows.set(s, r);
        }
        if (r) found.push(r);
      }
      return contractVerdict(t, found, nowIso());
    },
  };
}

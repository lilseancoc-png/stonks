// Webull sandbox mirror. Durable intents precede mutations; quantities come
// from cumulative broker fills. Engine exits and conservative expiry controls
// request closes; only confirmed fills or verified flat settlement end exposure.
import { marketSession, expiryControl, etClock } from "./us-equity-calendar.mjs";
import { parsePositions, reconcilePositions, contractKey } from "./webull-reconciliation.mjs";
import { bindNewFilledGroups, positionBindings, confirmedOrderLegs } from "./webull-position-groups.mjs";
import { createHash, createHmac } from "node:crypto";
import { pickTradeId, entryPrice, markPrice } from "./pick-trade-text.mjs";
import { fillPnlPct, entrySlippagePct, FILL_COLUMNS } from "./track-record-fills.mjs";
import { EXECUTION_POLICY, ENTRY_DWELL_MS, executionPrice, endOfDayWindow, entrySessionMatches } from "./webull-execution-policy.mjs";
import { engineName, engineByTag, ENGINES as ENGINE_SPECS, FLAGSHIP } from "./engines/config.mjs";
import { optionTick, NOT_TRADABLE_PREFIX } from "./webull-contracts.mjs";
import { feeBreakdown } from "./webull-fees.mjs";
import { WEBULL_STOCK_SOURCE, yahooBookOff, yahooLastPriceQuote } from "./webull-quotes.mjs";
import { makeCallQuota, quotaClient, quotaStop, EXIT_RESERVE } from "./webull-quota.mjs";
const engineTag = (id) => ENGINE_SPECS[id]?.tag || null;

export const LEDGER_KEY = "webull-paper-ledger.json";
export const ACCOUNT_LABEL = "Webull paper";
const ENTRY_MAX_ATTEMPTS = 2;
const EXIT_MAX_ATTEMPTS = 12;
const MIN_RUN_GAP_MS = 60 * 1000;
const RUNS_KEPT = 60;
const GO_LIVE_LOOKBACK_MS = 3 * 60 * 60 * 1000;
const MAX_CANCEL_FAILS = 3;
// Webull answers a cancel request before it applies it, so the order read
// straight after can still show the order working (first live sized window,
// 2026-11-19: "1 cancel unconfirmed" on the last follow-up). Before calling a
// cancel unconfirmed the mirror reads the order again after these waits, as
// long as the run's time budget allows.
export const CANCEL_SETTLE_MS = Object.freeze([1000, 2000]);
// Quantities (2026-11-19): an option trade sends its record's `qty` (engines)
// or a risk-sized count (Top Picks), never more than this many contracts
// (10 until 2026-11-20, 25 until 2026-11-23, then 200; owner, 2026-11-23:
// "Options up to 200 contracts per trade or a limit of $200,000 whichever
// first ... Top picks can increase the cap to 200 contracts cap too with the
// same $200,000 limit", and puts "100 contracts or a limit of $100,000").
// Top Picks use the Owner Settings caps WEBULL_PICKS_MAX_QTY /
// WEBULL_PICKS_MAX_PREMIUM_USD and, for a put, WEBULL_PICKS_PUT_MAX_QTY /
// WEBULL_PICKS_PUT_MAX_PREMIUM_USD; an engine trade's record is already
// inside the engines' own caps (ENGINES_MAX_QTY, ENGINES_MAX_PREMIUM_USD and
// the put caps). Every cap applies to new orders only: a ledger trade keeps
// the size it was given.
export const MIRROR_MAX_QTY = 200;
export const PICKS_MAX_QTY = 200;
export const PICKS_MAX_PREMIUM_USD = 200000;
export const PICKS_PUT_MAX_QTY = 100;
export const PICKS_PUT_MAX_PREMIUM_USD = 100000;
// Top Picks risk budget per trade when no Owner Settings value reaches the
// mirror: the same default as the engines' ENGINES_RISK_USD.
export const DEFAULT_RISK_USD = 2000;
// Engine stock orders at Webull (Owner rule, 2026-11-19; $2,000 to $25,000
// until 2026-11-23, owner: "For shares its minimum is $10,000 and at most
// $250,000"): each share trade buys at least this many dollars of stock and
// at most this many, at the engine's entry price. Owner Settings WEBULL_STOCK_MIN_USD /
// WEBULL_STOCK_MAX_USD change them (a Vercel value wins); the engine records
// keep their own share counts.
export const STOCK_MIN_USD = 10000;
export const STOCK_MAX_USD = 250000;
// What a mirror run does when its caller passes no sizing: the behavior
// before 2026-11-19 (one contract per option trade, no share orders). The
// endpoint always passes the live switches (Owner Settings WEBULL_QTY,
// WEBULL_PICKS_SIZING, WEBULL_SHARES; each on unless turned off), so this only
// keeps older callers and tests on the path they were written for.
const PICKS_CAPS = Object.freeze({ picksMaxQty: PICKS_MAX_QTY, picksMaxPremiumUsd: PICKS_MAX_PREMIUM_USD, picksPutMaxQty: PICKS_PUT_MAX_QTY, picksPutMaxPremiumUsd: PICKS_PUT_MAX_PREMIUM_USD });
export const DEFAULT_SIZING = Object.freeze({ quantities: false, picksSizing: false, shares: false, riskUsd: DEFAULT_RISK_USD, stockMinUsd: STOCK_MIN_USD, stockMaxUsd: STOCK_MAX_USD, ...PICKS_CAPS });
// Every part on: what the endpoint passes when no switch is off.
export const LIVE_SIZING = Object.freeze({ quantities: true, picksSizing: true, shares: true, riskUsd: DEFAULT_RISK_USD, stockMinUsd: STOCK_MIN_USD, stockMaxUsd: STOCK_MAX_USD, ...PICKS_CAPS });

// Webull's order statuses: SUBMITTED, CANCELLED, FAILED, FILLED, PARTIAL_FILLED
// ("PARTIAL FILLED" in the SDK's labels). Anything not known to be final
// counts as still working, so an unfamiliar status can never let a second
// order go out next to a live one. CANCEL_FAILED is the mirror's own marker.
const WAIT_NOTE = "Waiting: orders are paused until the broker holdings check passes.";
// An entry held for the next run by Webull's paper call limit (lib/webull-quota.mjs).
const QUOTA_NOTE = "Waiting: Webull's call limit for this minute is used up; the entry goes out at the next run.";
const SHARED_WAIT = "Waiting:";
const FINAL = new Set(["FILLED", "CANCELLED", "FAILED", "REJECTED", "EXPIRED"]);
// Stock has no expiry: no expiry control, never "expired".
const NO_EXPIRY = Object.freeze({ known: true, due: false, expired: false, stock: true });

const num = (v) => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const r2 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);
const r1 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10);

// Bearer token the build workflow sends to trigger a run. Derived from a
// secret both Vercel and GitHub already hold (R2_SECRET_ACCESS_KEY), so no new
// shared secret is needed and the token itself never appears in a log.
export function mirrorTriggerToken(secret) {
  return createHmac("sha256", String(secret)).update("webull-mirror-trigger:v1").digest("hex");
}

// --- Contract description ----------------------------------------------------

function ymd(expirySec) {
  const n = num(expirySec);
  if (n == null) return null;
  const d = new Date(n * 1000);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null;
}

// Legs as Webull wants them, opening direction. Null when the record entry
// can't be described (no contract, missing strikes).
export function mirrorLegs(e) {
  const c = e?.contract;
  if (!c) return null;
  const structure = c.structure || "long";
  // A share trade has no option legs: it is one stock line (isStockTrade).
  if (structure === "shares") return [];
  if (structure === "debit_vertical" || structure === "credit_vertical") {
    if (!Array.isArray(c.legs) || c.legs.length !== 2 || c.legs.some((l) => ![1, -1].includes(num(l.qty))) || c.legs.filter((l) => num(l.qty) === 1).length !== 1) return null;
    const legs = c.legs.map((l) => ({
      side: (num(l.qty) || 0) > 0 ? "BUY" : "SELL",
      type: String(l.type || c.optionType || e.side) === "put" ? "PUT" : "CALL",
      strike: num(l.strike),
      expiry: ymd(l.expiry ?? c.expiry),
      expirySec: num(l.expiry ?? c.expiry),
      lastTradingDate: l.lastTradingDate || c.lastTradingDate || null,
    }));
    return legs.every((l) => l.strike > 0 && l.expiry && l.expiry === legs[0].expiry && l.type === legs[0].type) && legs[0].strike !== legs[1].strike ? legs : null;
  }
  if (structure !== "long") return null;
  const strike = num(c.strike), expiry = ymd(c.expiry);
  if (strike == null || !expiry) return null;
  return [{ side: "BUY", type: e.side === "put" ? "PUT" : "CALL", strike, expiry, expirySec: num(c.expiry), lastTradingDate: c.lastTradingDate || null }];
}

// The date of a split the engine trade `e` was rescaled for that this
// ledger trade has not followed, or null. An option ledger whose strikes
// already match the engine's (it was first mirrored after the split) is in
// the new units; a stock ledger is behind when the split is dated after its
// fill (or, unfilled, after the engine entry its size was set from).
export function splitSinceLedger(t, e) {
  const acts = Array.isArray(e?.corpActions) ? e.corpActions.filter((a) => a?.type === "split" && a.date) : [];
  if (!acts.length || !t || !(t.openQty > 0 || t.state === "entering")) return null;
  const last = acts.map((a) => String(a.date)).sort().at(-1);
  if (isStockTrade(t)) { const since = Date.parse(t.fillIso || t.engineEntryIso || ""); return !Number.isFinite(since) || Date.parse(last) > since ? last : null; }
  const now = mirrorLegs(e);
  if (!Array.isArray(now) || !Array.isArray(t.legs) || now.length !== t.legs.length) return last;
  const sorted = (legs) => legs.map((l) => num(l.strike)).sort((a, b) => a - b);
  const a = sorted(now), b = sorted(t.legs);
  return a.some((s, i) => !(Math.abs(s - b[i]) < 0.005)) ? last : null;
}

export function isCredit(structure) {
  return structure === "credit_vertical";
}

// A share trade (engine `contract.structure: "shares"`, 2026-11-19 on Webull):
// long stock, bought at entry and sold at exit, never sold short.
export const isStockTrade = (t) => t?.structure === "shares" || t?.contract?.structure === "shares";

// --- Quantities ----------------------------------------------------------------

const clampQty = (n, cap = MIRROR_MAX_QTY) => Math.min(Math.min(MIRROR_MAX_QTY, cap), Math.max(1, Math.floor(n)));
// A contract cap as set (Owner Settings or Vercel): a whole number from 1 to
// MIRROR_MAX_QTY, anything else the default.
export const normalizeQtyCap = (v, fallback = PICKS_MAX_QTY) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= MIRROR_MAX_QTY ? n : fallback;
};
// A premium cap as set: $1,000 to $1,000,000, anything else the default.
export const normalizePremiumCap = (v, fallback = PICKS_MAX_PREMIUM_USD) => {
  const n = Number(v);
  return v != null && v !== "" && Number.isFinite(n) && n >= 1000 && n <= 1000000 ? n : fallback;
};
const DAY_SEC = 86400;

// Top Picks risk sizing (2026-11-19, the engines' rule from the roadmap brief):
// risk per contract is the whole premium for an option held under a month,
// else premium x stop x 1.25 (the stop can gap), never more than the premium;
// a credit spread risks its width less the credit. Contracts = budget / risk,
// at least 1 and at most the Top Picks cap (`maxQty`, WEBULL_PICKS_MAX_QTY,
// 200 unless set; never above MIRROR_MAX_QTY) and the premium cap
// (`maxPremiumUsd`, WEBULL_PICKS_MAX_PREMIUM_USD, $200,000: contracts x
// price x 100, a credit spread its width less the credit), whichever comes
// first. A Top Pick is never skipped for size: the record trade exists
// either way, so the mirror buys at least one. The caller passes the put
// caps for a put (picksCapsFor). The Top Picks record itself stays in
// percent per contract.
export function picksRiskQty(e, budgetUsd = DEFAULT_RISK_USD, maxQty = PICKS_MAX_QTY, maxPremiumUsd = PICKS_MAX_PREMIUM_USD) {
  const c = e?.contract || {}, budget = num(budgetUsd);
  const price = num(entryPrice(e));
  if (!(budget > 0) || !(price > 0)) return { qty: 1, riskPerContract: null };
  const structure = c.structure || "long";
  let risk, cash1;
  if (structure === "credit_vertical") {
    const strikes = (Array.isArray(c.legs) ? c.legs : []).map((l) => num(l.strike)).filter((x) => x != null);
    const width = strikes.length === 2 ? Math.abs(strikes[0] - strikes[1]) : null;
    if (!(width > price)) return { qty: 1, riskPerContract: null };
    risk = (width - price) * 100; cash1 = risk;
  } else {
    const premium = price * 100;
    const expSec = num(c.expiry ?? c.legs?.[0]?.expiry), entrySec = Date.parse(e.entryDate) / 1000;
    const dte = expSec != null && Number.isFinite(entrySec) ? (expSec - entrySec) / DAY_SEC : null;
    const stopFrac = Math.abs(num(e.exitPolicy?.stopPct) ?? 50) / 100;
    // Under a month (or an unknown expiry): the whole premium is at risk.
    risk = dte == null || dte < 30 ? premium : Math.min(premium, premium * (stopFrac > 0 ? stopFrac : 0.5) * 1.25);
    cash1 = premium;
  }
  if (!(risk > 0)) return { qty: 1, riskPerContract: null };
  const premUsd = normalizePremiumCap(maxPremiumUsd), qtyCap = normalizeQtyCap(maxQty);
  const premQty = cash1 > 0 ? Math.max(1, Math.floor(premUsd / cash1 + 1e-9)) : qtyCap;
  const cap = Math.min(qtyCap, premQty), want = Math.floor(budget / risk);
  return { qty: clampQty(want, cap), riskPerContract: r2(risk), cap, capBy: premQty < qtyCap ? "premium" : "contracts", maxPremiumUsd: premUsd, ...(want > cap ? { capped: true, wantQty: want } : {}) };
}
// The Top Picks caps for one record trade: a put (side "put") is held under
// the put caps too, never over the calls' (2026-11-23).
export function picksCapsFor(e, s = DEFAULT_SIZING) {
  const qty = normalizeQtyCap(s?.picksMaxQty), prem = normalizePremiumCap(s?.picksMaxPremiumUsd);
  if (e?.side !== "put") return { maxQty: qty, maxPremiumUsd: prem };
  return { maxQty: Math.min(qty, normalizeQtyCap(s?.picksPutMaxQty, PICKS_PUT_MAX_QTY)), maxPremiumUsd: Math.min(prem, normalizePremiumCap(s?.picksPutMaxPremiumUsd, PICKS_PUT_MAX_PREMIUM_USD)) };
}

// The stock order range in force: a value set in the Vercel environment wins,
// else the saved Owner Settings value, else the default. 0 (or blank) for the
// minimum = no minimum. A minimum above the maximum is read as the maximum,
// so the range is never empty.
export function stockRangeFromSettings(values = {}, env = process.env) {
  const pick = (key, pinned) => (pinned != null && String(pinned).trim() !== "" ? pinned : values?.[key]);
  const read = (raw, fallback, floor) => {
    if (raw == null || String(raw).trim() === "") return fallback;
    const n = Number(raw);
    return Number.isFinite(n) && n >= floor ? n : fallback;
  };
  const maxUsd = read(pick("WEBULL_STOCK_MAX_USD", env?.WEBULL_STOCK_MAX_USD), STOCK_MAX_USD, 1);
  const minUsd = Math.min(read(pick("WEBULL_STOCK_MIN_USD", env?.WEBULL_STOCK_MIN_USD), STOCK_MIN_USD, 0), maxUsd);
  return { stockMinUsd: minUsd, stockMaxUsd: maxUsd };
}
// The Top Picks caps at Webull (2026-11-20; premium and put caps
// 2026-11-23): Owner Settings WEBULL_PICKS_MAX_QTY (1 to MIRROR_MAX_QTY,
// default 200), WEBULL_PICKS_MAX_PREMIUM_USD (default $200,000),
// WEBULL_PICKS_PUT_MAX_QTY (default 100), WEBULL_PICKS_PUT_MAX_PREMIUM_USD
// (default $100,000); a Vercel value wins; blank or out of range = the
// default.
export function picksCapFromSettings(values = {}, env = process.env) {
  // Each key is read by name (the Owner Settings smoke checks every key is
  // really read from the environment).
  const raw = (key, pinned) => { const v = pinned != null && String(pinned).trim() !== "" ? pinned : values?.[key]; return v == null || String(v).trim() === "" ? null : Number(String(v).trim()); };
  const q = (v, d) => (v == null ? d : normalizeQtyCap(v, d));
  const p = (v, d) => (v == null ? d : normalizePremiumCap(v, d));
  return {
    picksMaxQty: q(raw("WEBULL_PICKS_MAX_QTY", env?.WEBULL_PICKS_MAX_QTY), PICKS_MAX_QTY),
    picksMaxPremiumUsd: p(raw("WEBULL_PICKS_MAX_PREMIUM_USD", env?.WEBULL_PICKS_MAX_PREMIUM_USD), PICKS_MAX_PREMIUM_USD),
    picksPutMaxQty: q(raw("WEBULL_PICKS_PUT_MAX_QTY", env?.WEBULL_PICKS_PUT_MAX_QTY), PICKS_PUT_MAX_QTY),
    picksPutMaxPremiumUsd: p(raw("WEBULL_PICKS_PUT_MAX_PREMIUM_USD", env?.WEBULL_PICKS_PUT_MAX_PREMIUM_USD), PICKS_PUT_MAX_PREMIUM_USD),
  };
}
// Whole shares for one engine stock order: the record's count when its cost
// at the entry price is inside the range, else raised to the fewest shares
// that reach the minimum, or cut to the most that stay under the maximum.
// One share costing more than the maximum = null (not bought).
export function stockOrderShares(recordShares, price, minUsd = STOCK_MIN_USD, maxUsd = STOCK_MAX_USD) {
  const n = num(recordShares), px = num(price);
  if (!Number.isInteger(n) || n < 1) return { qty: null, basis: "shares" };
  const hi = num(maxUsd) > 0 ? num(maxUsd) : null;
  const lo = Math.min(num(minUsd) > 0 ? num(minUsd) : 0, hi ?? Infinity);
  if (!(px > 0)) return { qty: n, basis: "shares" };
  const fitMax = hi != null ? Math.floor(hi / px + 1e-9) : Infinity;
  if (fitMax < 1) return { qty: null, basis: "shares-over-max" };
  if (n * px > (hi ?? Infinity) + 1e-9) return { qty: fitMax, basis: "shares-max" };
  if (n * px < lo - 1e-9) return { qty: Math.min(Math.ceil(lo / px - 1e-9), fitMax), basis: "shares-min" };
  return { qty: n, basis: "shares" };
}

// What one record trade asks Webull for. Options: an engine trade's `qty`
// (1 to MIRROR_MAX_QTY, 200; a missing value is 1, as on every trade before
// 2026-11-17), a Top Pick's risk size behind its own switch; one contract
// when the quantities switch is off. Shares: the record's whole-share count,
// moved inside the stock order range (stockOrderShares; the shares switch
// decides whether a share trade reaches the mirror at all).
export function mirrorQty(e, sizing = DEFAULT_SIZING) {
  const c = e?.contract || {}, s = { ...DEFAULT_SIZING, ...(sizing || {}) };
  if (c.structure === "shares") {
    const n = num(c.shares);
    if (!(Number.isInteger(n) && n > 0)) return { qty: null, recordQty: null, basis: "shares" };
    const r = stockOrderShares(n, entryPrice(e), s.stockMinUsd, s.stockMaxUsd);
    // The range as applied (a minimum above the maximum reads as the maximum).
    const hi = num(s.stockMaxUsd) > 0 ? num(s.stockMaxUsd) : null, lo = Math.min(num(s.stockMinUsd) > 0 ? num(s.stockMinUsd) : 0, hi ?? Infinity);
    return { qty: r.qty, recordQty: n, basis: r.basis, ...(r.basis !== "shares" ? { stockMinUsd: lo, stockMaxUsd: hi } : {}) };
  }
  const recordQty = Number.isInteger(num(c.qty)) && num(c.qty) > 0 ? num(c.qty) : null;
  if (!s.quantities) return { qty: 1, recordQty, basis: "one" };
  if (e?.engine) return { qty: clampQty(recordQty ?? 1), recordQty, basis: recordQty == null ? "one" : recordQty > MIRROR_MAX_QTY ? "record-capped" : "record" };
  if (!s.picksSizing) return { qty: 1, recordQty, basis: "one" };
  // No budget given (riskUsd null: the Owner Settings file drops a value equal
  // to its default, and no Vercel value) means the $2,000 default, not one
  // contract (2026-11-23 readiness audit).
  const budget = num(s.riskUsd) > 0 ? num(s.riskUsd) : DEFAULT_RISK_USD;
  const caps = picksCapsFor(e, s);
  const r = picksRiskQty(e, budget, caps.maxQty, caps.maxPremiumUsd);
  return { qty: r.qty, recordQty, basis: "risk", riskPerContract: r.riskPerContract, riskUsd: budget, maxQty: r.cap, ...(r.capBy === "premium" ? { capBy: "premium", maxPremiumUsd: r.maxPremiumUsd } : {}), ...(r.capped ? { capped: true, wantQty: r.wantQty } : {}) };
}

// Option ticks: $0.01 under $3, $0.05 at $3 and up (the Penny Interval
// Program rule; a nickel is always a valid price there). Spreads trade in
// pennies. A contract Webull's own list flags as outside the program
// (ppind false, lib/webull-contracts.mjs, 2026-11-19) steps $0.05 under $3
// and $0.10 at $3 and up.
export function roundTick(price, { spread = false, nickel = false, ppind = null } = {}) {
  const p = num(price);
  if (p == null || !(p > 0)) return null;
  const step = optionTick(p, { ppind, spread });
  const tick = nickel ? Math.max(0.05, step) : step;
  return Number(Math.max(tick, Math.round(p / tick) * tick).toFixed(2));
}

function priceText(p) {
  return Number(p).toFixed(2);
}

// Deterministic client_order_id (Webull caps it at 32 chars, unique per
// account): a rerun of the same attempt reuses the same id, so a crash between
// placing and saving can't double-buy. A strategy-engine order carries its
// engine's three-letter tag right after "ms" ("mstec…" = Technicals), so the
// engine can be read in the Webull app itself; a Top Picks order keeps the
// plain form ("ms" + 28 hex characters, which can never spell a tag). Always
// 30 characters. The id is stored on each attempt, so orders sent before the
// tag was added (2026-11-16) keep the id they were sent with.
export function clientOrderId(tradeId, phase, attempt, engine = null) {
  const hex = createHash("sha256").update(`${tradeId}|${phase}|${attempt}`).digest("hex");
  const tag = engine ? String(engineTag(engine) || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 6) : "";
  return "ms" + tag + hex.slice(0, 28 - tag.length);
}
// "mstec3fa9…" → "TEC"; a Top Picks order id → "TOP". For reading an order
// id back (the page and the downloads use the stored `engine` instead).
export function orderIdTag(coid) {
  const m = /^ms([a-z]{3})[0-9a-f]+$/.exec(String(coid || ""));
  return m && engineByTag(m[1].toUpperCase()) ? m[1].toUpperCase() : FLAGSHIP.tag;
}
// What an order's id starts with at Webull: "mstec" for a tagged engine
// order, "ms" for Top Picks and for any order sent before tags (null when
// the attempt has no id). The id itself never goes to the page.
export function orderIdPrefix(coid) {
  if (!coid) return null;
  const tag = orderIdTag(coid);
  return tag === FLAGSHIP.tag ? "ms" : "ms" + tag.toLowerCase();
}

// One Webull order body. phase "entry" opens, "exit" closes.
export function buildOrder(t, phase, limit, coid, quantity = 1) {
  if (!Number.isInteger(quantity) || quantity < 1) throw new Error("invalid order quantity");
  if (isStockTrade(t)) {
    // Webull OpenAPI stock order (developer.webull.com/apis/docs/trade-api/stock,
    // "Limit Buy" example; the official Python SDK 3.0.4 samples/order/
    // order_stock_client.py). Whole shares, regular hours only, DAY. Long
    // only: BUY opens, SELL closes, never SHORT.
    return {
      client_order_id: coid,
      combo_type: "NORMAL",
      symbol: t.symbol,
      instrument_type: "EQUITY",
      market: "US",
      order_type: "LIMIT",
      limit_price: priceText(limit),
      quantity: String(quantity),
      side: phase === "entry" ? "BUY" : "SELL",
      time_in_force: "DAY",
      support_trading_session: "CORE",
      entrust_type: "QTY",
    };
  }
  const spread = t.legs.length > 1;
  const credit = isCredit(t.structure);
  const opening = phase === "entry";
  // Order-level side: buying the position (long / debit spread open, credit
  // spread close) is BUY; the reverse is SELL.
  const buying = opening ? !credit : credit;
  const flip = (s) => (s === "BUY" ? "SELL" : "BUY");
  const legs = t.legs.map((l) => ({
    side: opening ? l.side : flip(l.side),
    quantity: String(quantity),
    symbol: t.symbol,
    strike_price: String(l.strike),
    option_expire_date: l.expiry,
    instrument_type: "OPTION",
    option_type: l.type,
    market: "US",
  }));
  const order = {
    client_order_id: coid,
    instrument_type: "OPTION", market: "US", symbol: t.symbol,
    combo_type: "NORMAL",
    order_type: "LIMIT",
    quantity: String(quantity),
    limit_price: priceText(limit),
    option_strategy: spread ? "VERTICAL" : "SINGLE",
    side: buying ? "BUY" : "SELL",
    time_in_force: "DAY",
    entrust_type: "QTY",
    legs,
  };
  if (!spread) order.position_intent = opening ? "BUY_TO_OPEN" : "SELL_TO_CLOSE";
  return order;
}

// --- Labels ------------------------------------------------------------------

// + = the paper price is above the engine's.
export function diffPct(paper, engine) {
  const p = num(paper), e = num(engine);
  if (p == null || e == null || !(e > 0)) return null;
  return r1((p / e - 1) * 100);
}

function relWord(pct, actual, modeled) {
  if (pct == null) return "";
  if (Math.abs(actual - modeled) < 1e-9) return "at the engine's price";
  return `${Math.abs(pct) < 0.05 ? "<0.1" : Math.abs(pct).toFixed(1)}% ${actual > modeled ? "above" : "below"} engine`;
}

export function entryLabel(t) {
  const d = t.entryDiffPct;
  if (d == null) return null;
  return isCredit(t.structure) ? `Paper sold to open ${relWord(d, t.fillPrice, t.engineEntryPrice)}` : `Paper bought ${relWord(d, t.fillPrice, t.engineEntryPrice)}`;
}

export function exitLabel(t) {
  const d = t.exitDiffPct;
  if (d == null) return null;
  return isCredit(t.structure) ? `Paper bought back ${relWord(d, t.closeFillPrice, t.engineExitPrice)}` : `Paper sold ${relWord(d, t.closeFillPrice, t.engineExitPrice)}`;
}

// Why an engine stock order's share count differs from the record's (the
// Owner's stock order range), or null when it does not.
export function stockSizeNote(t) {
  const r = t?.stockRange, usd = (v) => `$${Math.round(Number(v)).toLocaleString("en-US")}`;
  if (!r) return null;
  if (t.qtyBasis === "shares-min") return `Raised to the ${usd(r.minUsd)} stock order minimum: ${t.requestedQty} shares (record ${t.recordQty})`;
  if (t.qtyBasis === "shares-max") return `Cut to the ${usd(r.maxUsd)} stock order maximum: ${t.requestedQty} shares (record ${t.recordQty})`;
  if (t.qtyBasis === "shares-over-max") return `One share costs more than the ${usd(r.maxUsd)} stock order maximum`;
  return null;
}

export function paperPnlPct(t) {
  const open = num(t.fillPrice), close = num(t.closeFillPrice);
  if (open == null || close == null || !(open > 0)) return null;
  return r1(isCredit(t.structure) ? (open - close) / open * 100 : (close / open - 1) * 100);
}

// --- Market hours ------------------------------------------------------------

export function isRegularSession(nowMs) { return marketSession(nowMs).trading; }

// Webull refuses option orders outside 9:30-16:00 ET with HTTP 417
// OPENAPI_OPTION_ONLY_SUPPORT_MARKET_IN_CORE_TIME, paper accounts included.
export function isOrderNotFoundError(err) {
  return /not present|not exist|not found/i.test(String(err?.message || ""));
}

export function isMarketClosedError(err) {
  return /CORE_TIME/i.test(String(err?.code || "")) || /available trading hours/i.test(String(err?.message || ""));
}

// Preview -> estimated fee in $ for the whole order (Webull answers
// { estimated_cost, estimated_transaction_fee, currency }).
export function parsePreviewFee(resp) {
  const body = Array.isArray(resp) ? resp[0] : resp?.data && typeof resp.data === "object" ? resp.data : resp;
  const fee = num(body?.estimated_transaction_fee ?? body?.estimated_fee ?? body?.fee);
  return fee != null && fee >= 0 ? fee : null;
}

// --- Ledger ------------------------------------------------------------------

export function emptyLedger() {
  return { version: 1, goLiveIso: null, lastRunIso: null, accountId: null, trades: {}, runs: [] };
}

// A Top Picks row is keyed by its entry-time ID; a strategy-engine row
// (lib/engines/) carries its own tagged ID ("TEC:AAPL-C-11/16/26-11:00"), so
// two engines that open one name in one run stay apart.
export const mirrorTradeId = (e) => (e?.engine && e?.tradeId ? String(e.tradeId) : pickTradeId(e));

function engineIndex(acc) {
  const map = new Map();
  for (const e of Array.isArray(acc?.open) ? acc.open : []) if (e?.symbol && e.entryDate) map.set(mirrorTradeId(e), { e, closed: false });
  for (const e of Array.isArray(acc?.closed) ? acc.closed : []) if (e?.symbol && e.entryDate) map.set(mirrorTradeId(e), { e, closed: true });
  return map;
}

// --- Strategy engines ----------------------------------------------------------
// Every engine shares the one paper account. Their trades join the Top Picks
// record for a mirror run (Top Picks rows first, then engine rows, rows an
// engine marked "held by another engine" last) and are told apart by
// `engine` on the ledger trade.
//   mirrorNew false (ENGINES_MIRROR=0): no new engine trade enters the mirror;
//   trades already in the ledger keep being managed and closed.
export const sourceName = (id) => engineName(id || "flagship");
// Fixed labels for the public log line (see describeReviewKinds).
export const REVIEW_KIND_LABELS = {
  EOD_ORDER_UNCONFIRMED: "order outcome unconfirmed at the close",
  EOD_EXIT_UNFILLED: "signaled exit unfilled at the close",
  CANCEL_UNCONFIRMED: "cancel unconfirmed",
  FILL_PRICE_UNCONFIRMED: "fill price not confirmed",
  SPLIT_REVIEW: "stock split since entry",
};
function countReviewKinds(kinds) {
  const out = {};
  for (const { kind, source } of kinds) { const k = source ? `${kind} (${source})` : kind; out[k] = (out[k] || 0) + 1; }
  return out;
}
// "1 order outcome unconfirmed at the close (Fundamentals)" for a public log.
// "3 order status unavailable; 1 cancel unconfirmed" from a { label: n } map of
// fixed labels (summary.errorKinds / pendingKinds; never a ticker or an ID).
export function describeKindCounts(k) {
  if (!k || typeof k !== "object") return "";
  return Object.entries(k).map(([label, n]) => `${Number(n) || 0} ${String(label).replace(/[^a-z0-9 %/-]/gi, "").slice(0, 80)}`).slice(0, 6).join("; ");
}
export function describeReviewKinds(summary) {
  const k = summary?.reviewKinds;
  if (!k || typeof k !== "object") return "";
  return Object.entries(k).map(([label, n]) => `${Number(n) || 0} ${String(label).slice(0, 80)}`).slice(0, 6).join("; ");
}
// --- Cash check (no margin, ever) ------------------------------------------------
// Before each opening order the mirror checks that the paper account's cash
// buying power covers it, so no buy can lean on margin. Exits never wait for it.
//
// Field: Webull's US Account Balance reply (GET /trading/assets/balances/get,
// the SDK's account_v2.get_account_balance), as the US API reference lays it
// out (developer.webull.com/apis/docs/reference/account-balance, read
// 2026-11-19): a per-currency list `account_currency_assets`, each row with
// `currency`, `cash_balance`, `settled_cash` and `buying_power`, plus
// `total_cash_balance` at the top. The US reply has no `cash_power`. The
// mirror reads the USD row's settled cash, else its cash balance, else
// total_cash_balance; `buying_power` and every margin field include margin
// and are never read. A negative cash figure (money owed) counts as 0, so no
// opening buy goes. No captured sandbox reply is in the repo, so the mirror
// saves the live reply's key names (never values) as `balanceShape` in the
// ledger. A reply with none of these fields counts as "cash unknown": the
// order still goes and the run summary warns.
export const CASH_NOTE = "Not enough cash; no margin is used.";
export function parseCashPower(resp) {
  const body = resp && typeof resp === "object" && resp.data && typeof resp.data === "object" && !Array.isArray(resp.data) ? resp.data : resp;
  if (!body || typeof body !== "object") return null;
  const rows = Array.isArray(body.account_currency_assets) ? body.account_currency_assets : null;
  const usd = rows?.find((r) => String(r?.currency || "").toUpperCase() === "USD");
  const topUsd = !body.total_asset_currency || String(body.total_asset_currency).toUpperCase() === "USD";
  const v = num(usd?.settled_cash) ?? num(usd?.cash_balance) ?? (topUsd ? num(body.total_cash_balance) : null);
  return v == null ? null : Math.max(0, v);
}
// Key names only, never values: what the live reply carries.
export function balanceShape(resp) {
  const body = resp && typeof resp === "object" && resp.data && typeof resp.data === "object" && !Array.isArray(resp.data) ? resp.data : resp;
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const row = Array.isArray(body.account_currency_assets) ? body.account_currency_assets[0] : null;
  return { top: Object.keys(body).slice(0, 30), currencyRow: row && typeof row === "object" ? Object.keys(row).slice(0, 30) : null };
}
// Cash an opening order ties up: a share buy pays price x shares, an option
// or debit spread pays the premium x 100, and a credit spread holds its width
// less the credit x 100. Plus the previewed fee when Webull gave one.
export function openingCash(t, limit, quantity, fee = null) {
  const px = num(limit), q = Number(quantity);
  if (!(px > 0) || !Number.isInteger(q) || q < 1) return null;
  let base;
  if (isStockTrade(t)) base = px * q;
  else if (isCredit(t.structure) && t.legs?.length > 1) {
    const ks = t.legs.map((l) => num(l.strike)).filter((k) => k != null);
    const width = ks.length > 1 ? Math.max(...ks) - Math.min(...ks) : null;
    if (!(width > 0)) return null;
    base = Math.max(0, width - px) * 100 * q;
  } else base = px * 100 * q;
  const f = num(fee);
  return Math.round((base + (f != null && f > 0 ? f : 0)) * 100) / 100;
}

// Engine share trades (contract.structure "shares": the signal engines' share
// setups and the Trend / Momentum core engines) reach Webull as stock orders
// since 2026-11-19. shares false (the Owner Settings switch WEBULL_SHARES
// off): no new share trade joins; share trades already in the ledger keep
// being managed and closed, like ENGINES_MIRROR for every engine trade.
export function mergeEngineTrades(acc, enginesRecord, ledger, { mirrorNew = true, shares = false } = {}) {
  if (!Array.isArray(acc?.open) || !Array.isArray(acc?.closed)) return acc;
  const rows = (list) => (Array.isArray(list) ? list : []).filter((e) => e?.engine && e.tradeId && e.symbol && e.entryDate);
  const known = (e) => !!ledger?.trades?.[String(e.tradeId)];
  const keep = (e) => known(e) || mirrorNew && (shares || e.contract?.structure !== "shares");
  const open = rows(enginesRecord?.open).filter(keep), closed = rows(enginesRecord?.closed).filter(keep);
  return { ...acc, open: [...acc.open, ...open.filter((e) => !e.noMirror), ...open.filter((e) => e.noMirror)], closed: [...acc.closed, ...closed] };
}
// A ledger narrowed to one record's trades: "flagship" (Top Picks), "engines",
// or "all". Reports only; a mirror run always reads the whole ledger.
export function scopeLedger(ledger, scope = "flagship") {
  if (scope === "all" || !ledger?.trades) return ledger;
  const want = scope === "engines";
  return { ...ledger, trades: Object.fromEntries(Object.entries(ledger.trades).filter(([, t]) => !!t?.engine === want)) };
}

export function newTrade(e, id, sizing = DEFAULT_SIZING) {
  const structure = e.contract?.structure || "long";
  const size = mirrorQty(e, sizing);
  return {
    tradeId: id,
    ...(e.engine ? { engine: String(e.engine) } : {}),
    // The engine setup that opened it (2026-11-19), so paper results can be
    // read per setup without the engine record.
    ...(e.engine && e.setup ? { setup: String(e.setup) } : {}),
    symbol: e.symbol,
    side: e.side === "put" ? "put" : "call",
    structure,
    legs: mirrorLegs(e),
    engineEntryPrice: r2(entryPrice(e)),
    engineEntryIso: e.entryDate,
    state: "entering",
    executionPolicy: EXECUTION_POLICY,
    instrument: structure === "shares" ? "stock" : "option",
    requestedQty: size.qty ?? 1, filledQty: 0, closedQty: 0, openQty: 0,
    qtyBasis: size.basis, recordQty: size.recordQty ?? null,
    ...(size.riskPerContract != null ? { riskPerContract: size.riskPerContract, riskUsd: size.riskUsd } : {}),
    // The Top Picks cap in force, and the count the budget asked for when the
    // cap set the size (2026-11-20).
    ...(size.maxQty != null ? { qtyCap: size.maxQty } : {}), ...(size.capped ? { qtyWanted: size.wantQty } : {}),
    // The premium cap when it, not the contract cap, set the Top Picks cap (2026-11-23).
    ...(size.capBy === "premium" ? { qtyCapBy: "premium", premiumCapUsd: size.maxPremiumUsd } : {}),
    ...(size.stockMaxUsd != null ? { stockRange: { minUsd: size.stockMinUsd, maxUsd: size.stockMaxUsd } } : {}),
    entryAttempts: [],
    exitAttempts: [],
    fillPrice: null, fillIso: null, entryDiffPct: null,
    engineExitPrice: null, engineExitIso: null, engineCloseReason: null, enginePnlPct: null,
    closeFillPrice: null, closeFillIso: null, exitDiffPct: null,
    paperPnlPct: null, labels: [], note: null,
  };
}

function lastAttempt(t, phase) {
  const list = phase === "entry" ? t.entryAttempts : t.exitAttempts;
  return list.length ? list[list.length - 1] : null;
}

// Cumulative fills belong to attempts. Recomputing avoids counting the same
// partial fill or fee again on every poll, cancel, or process restart.
export function updateQuantities(t) {
  const totals = (list) => {
    let qty = 0, value = 0, fees = 0, priceKnown = true, feesKnown = true, timeKnown = true, iso = null;
    for (const a of list || []) {
      const filled = a.filledQty ?? (a.status === "FILLED" ? a.quantity ?? 1 : 0);
      if (!(filled > 0)) continue;
      qty += filled;
      if (num(a.filledPrice) == null) priceKnown = false;
      else value += filled * Number(a.filledPrice);
      if (num(a.feeActual) != null) fees += Number(a.feeActual);
      else if (num(a.feeEst) == null) feesKnown = false;
      else fees += Number(a.feeEst) * filled / (a.quantity ?? 1);
      if (!Number.isFinite(Date.parse(a.filledIso))) timeKnown = false;
      else if (!iso || Date.parse(a.filledIso) > Date.parse(iso)) iso = a.filledIso;
    }
    return { qty, price: qty && priceKnown ? value / qty : null, fees, feesKnown, iso: timeKnown ? iso : null };
  };
  const entry = totals(t.entryAttempts), exit = totals(t.exitAttempts);
  t.filledQty = entry.qty; t.closedQty = exit.qty;
  t.openQty = entry.qty - exit.qty - (t.settledQty || 0);
  t.fillPrice = entry.price; t.fillIso = entry.iso;
  t.closeFillPrice = exit.price; t.closeFillIso = exit.iso;
  t.fees = entry.feesKnown && exit.feesKnown ? r2(entry.fees + exit.fees) : null;
  t.entryDiffPct = diffPct(t.fillPrice, t.engineEntryPrice);
  t.exitDiffPct = diffPct(t.closeFillPrice, t.engineExitPrice);
  t.paperPnlPct = entry.qty > 0 && exit.qty === entry.qty ? paperPnlPct(t) : null;
  t.entryEndOfDayUsed = t.entryAttempts.some(a => a.policyStage === "eod-entry");
  t.emergencyExitUsed = t.exitAttempts.some(a => a.emergency);
  t.emergencyExitFilled = t.exitAttempts.some(a => a.emergency && a.filledQty > 0);
  const unit = isStockTrade(t) ? "shares" : "contracts";
  const entryDone = !t.entryAttempts.some((a) => !FINAL.has(a.status));
  t.labels = [t.entrySource === "manual" ? "Manual entry, broker-confirmed; automated exits only" : null,
    t.qtyBasis === "shares-min" || t.qtyBasis === "shares-max" ? stockSizeNote(t) : null, entryLabel(t),
    entry.qty > 0 && entry.qty < (t.requestedQty || 1) && entryDone && t.state !== "entering" ? `Partly filled: ${entry.qty} of ${t.requestedQty} ${unit}` : null,
    t.automaticEntryOutcome === "missed" ? "Earlier automatic entry missed; manually recovered" : null,
    exit.qty === entry.qty && entry.qty > 0 ? exitLabel(t) : null,
    t.entryEndOfDayUsed ? "End-of-day entry attempt (5% cap)" : null,
    t.emergencyExitUsed ? t.emergencyExitFilled ? t.openQty > 0 ? "Emergency end-of-day exit: broker-confirmed partial fill; exposure remains open" : "Emergency end-of-day exit: broker-confirmed fill" : "Emergency end-of-day exit attempted; fill not confirmed" : null].filter(Boolean);
}

// How much of a trade's entry Webull filled, for the record pages:
//   filled     every requested contract or share
//   partial    some, not all (the rest was cancelled or is still working)
//   missed     none, and the entry is over
//   pending    no fill yet, the entry is still being worked
//   shared     not bought: another tracked trade holds the same contract
//   not-bought skipped for another reason (contract unsupported, share count missing)
export function fillOutcome(t) {
  const requested = Number.isInteger(t?.requestedQty) && t.requestedQty > 0 ? t.requestedQty : 1;
  const filled = num(t?.filledQty) ?? (num(t?.fillPrice) != null ? 1 : 0);
  if (t?.state === "skipped") return t.sharedContract ? "shared" : "not-bought";
  if (filled >= requested) return "filled";
  if (filled > 0) return "partial";
  return t?.state === "missed" || t?.automaticEntryOutcome === "missed" && t?.entrySource !== "manual" ? "missed" : "pending";
}

// Order detail -> { status, filledPrice, filledIso }. Webull nests the order
// under `orders[]` for a client_order_id lookup; tolerate a bare order too.
export function parseOrderDetail(resp) {
  let o = resp;
  for (let i = 0; i < 5; i++) {
    if (Array.isArray(o)) { if (o.length !== 1) return null; o = o[0]; }
    else if (o?.data) o = o.data;
    else if (o?.orders) { if (o.orders.length !== 1) return null; o = o.orders[0]; }
    else if (o?.order) o = o.order;
    else break;
  }
  if (!o || typeof o !== "object") return null;
  const status = String(o.status || o.order_status || "").trim().toUpperCase().replace(/[\s-]+/g, "_") || null;
  const filledQty = num(o.filled_quantity);
  const filledPrice = num(o.filled_price) ?? num(o.avg_filled_price);
  let filledIso = o.filled_time_at || null;
  if (!filledIso && num(o.filled_time)) filledIso = new Date(num(o.filled_time)).toISOString();
  if (!Number.isFinite(Date.parse(filledIso))) filledIso = null;
  const commissionKnown = o.commission && typeof o.commission === "object" && !Array.isArray(o.commission) &&
    (Object.keys(o.commission).length === 0 || num(o.commission.actual_commission) != null && num(o.commission.actual_commission) >= 0);
  const actualFees = Array.isArray(o.fees) && o.fees.every(f => num(f.actual_value) != null && num(f.actual_value) >= 0) && commissionKnown
    ? o.fees.reduce((s, f) => s + num(f.actual_value), num(o.commission?.actual_commission) || 0) : null;
  return { status, filledQty, filledPrice: filledPrice && filledPrice > 0 ? filledPrice : null, filledIso,
    feeActual: actualFees, brokerLegs: confirmedOrderLegs(o), brokerOrderId: o.order_id == null ? null : String(o.order_id) };
}

// Append changes to known order evidence. Quantities/prices are cumulative
// broker snapshots, never invented individual execution lots. Identical polls
// do not add rows; repeated submissions/cancellation requests are retained.
export function recordOrderObservation(a, kind, observedIso) {
  const row = { kind, observedIso, status: a.status, filledQty: a.filledQty ?? 0,
    filledPrice: a.filledPrice ?? null, filledIso: a.filledIso ?? null,
    feeActual: a.feeActual ?? null, brokerOrderId: a.brokerOrderId ?? a.order?.order_id ?? null };
  a.observations ||= [];
  const previous = a.observations.at(-1);
  if (kind === "broker-detail" && previous && JSON.stringify({ ...previous, observedIso: null }) === JSON.stringify({ ...row, observedIso: null })) return;
  a.observations.push(row);
}

export function resolveOrderReview(t) {
  const attempts = [...t.entryAttempts, ...t.exitAttempts];
  const cancelledReview = t.reviewCode === "CANCEL_UNCONFIRMED" || !t.reviewCode && ["entry", "exit"].some(p => t.note === `couldn't confirm the ${p} order was cancelled; check Webull by hand`);
  const resolved = cancelledReview && attempts.some(a => a.cancelFails >= MAX_CANCEL_FAILS) && attempts.every(a => !(a.cancelFails >= MAX_CANCEL_FAILS) || FINAL.has(a.status) && !a.lookupFailed) ||
    t.reviewCode === "EOD_ORDER_UNCONFIRMED" && attempts.every(a => FINAL.has(a.status) && !a.lookupFailed) ||
    t.reviewCode === "EOD_EXIT_UNFILLED" && t.openQty === 0 ||
    t.reviewCode === "FILL_PRICE_UNCONFIRMED" && t.fillPrice != null && (!t.closedQty || t.closeFillPrice != null);
  if (resolved) { t.needsReview = false; t.reviewCode = null; t.note = null; }
}

// --- Runner ------------------------------------------------------------------

// quoteFn(trade) -> { bid, ask } for the whole position per share in its
// opening direction (a spread's net debit / credit), or null.
export async function runWebullMirror({ client, accountId, acc, ledger, nowMs = Date.now(), quoteFn = async () => null,
  placeOrders = true, checkpoint = async () => {}, guard = () => {}, clock = Date.now, budgetMs = 40000, endOfDayOnly = false, enginesUnavailable = false,
  openGate = null, sizing = DEFAULT_SIZING, pause = (ms) => new Promise((r) => setTimeout(r, ms)), contractCheck = null }) {
  const sz = { ...DEFAULT_SIZING, ...(sizing || {}) };
  const L = ledger && typeof ledger === "object" ? ledger : emptyLedger();
  L.trades ||= {}; L.runs = Array.isArray(L.runs) ? L.runs : [];
  const nowIso = new Date(nowMs).toISOString(), started = clock(), log = [];
  const eventMs = () => nowMs + Math.max(0, clock() - started);
  const eventIso = () => new Date(eventMs()).toISOString();
  const summary = { at: nowIso, placed: 0, filled: 0, cancelled: 0, missed: 0, closed: 0, errors: 0, skipped: null, note: null };
  // Errors by fixed kind (2026-11-19): labels only, never a ticker or an ID,
  // so the public workflow log can say what went wrong.
  const errorOf = (kind) => { summary.errors++; (summary.errorKinds ||= {})[kind] = (summary.errorKinds[kind] || 0) + 1; };
  // Warnings by fixed kind: shown in the workflow log, never a failure.
  const warnOf = (kind) => { (summary.warnings ||= {})[kind] = (summary.warnings[kind] || 0) + 1; };
  // Webull data use by fixed kind (2026-11-19): contract checks, misses.
  const dataOf = (kind) => { (summary.webullData ||= {})[kind] = (summary.webullData[kind] || 0) + 1; };
  const check = () => { guard(); if (clock() - started >= budgetMs) throw Object.assign(new Error("reconciliation budget reached"), { code: "RUN_BUDGET" }); };
  const save = async () => { guard(); await checkpoint(L); };
  if (!Array.isArray(acc?.open) || !Array.isArray(acc?.closed)) return { ledger: L, summary: { ...summary, skipped: "track record unavailable" }, log };
  if (L.accountId && L.accountId !== String(accountId)) throw Object.assign(new Error("ledger belongs to another account"), { code: "ACCOUNT_MISMATCH" });
  if (L.lastRunIso && nowMs - Date.parse(L.lastRunIso) < MIN_RUN_GAP_MS && (L.engineSnapshotIso ?? null) === (acc.builtAtIso ?? null)) return { ledger: L, summary: { ...summary, skipped: "ran less than a minute ago" }, log };
  const listed = await client.accountList();
  const accounts = Array.isArray(listed) ? listed : Array.isArray(listed?.accounts) ? listed.accounts : Array.isArray(listed?.data) ? listed.data : [];
  if (!accounts.some((a) => String(a?.account_id ?? a?.accountId ?? a?.id) === String(accountId))) throw Object.assign(new Error("configured Webull paper account is not in this key's account list"), { code: "ACCOUNT_NOT_FOUND" });
  L.accountId = String(accountId); L.version = 2;
  // Webull's paper call limits (2026-11-23, lib/webull-quota.mjs): every
  // order, preview, cancel, order read, balance and positions call is counted
  // in the ledger across runs; a call with no room left stops the run like
  // the time budget does, before anything is sent.
  if (!L.webullCalls || typeof L.webullCalls !== "object" || Array.isArray(L.webullCalls)) L.webullCalls = {};
  const quota = makeCallQuota(L.webullCalls, { now: eventMs });
  client = quotaClient(client, quota);
  // What a new entry order needs: its preview, the order, one read if Webull
  // does not acknowledge it, the cash read on the run's first entry, and
  // EXIT_RESERVE orders left over for exits.
  const entryNeed = () => ({ placeOrder: 1 + EXIT_RESERVE, previewOrder: 1, orderDetail: 1, ...(cash ? {} : { balance: 1 }) });
  // A re-price also cancels the working order and reads it up to three times.
  const repriceNeed = () => ({ ...entryNeed(), cancelOrder: 1, orderDetail: 1 + CANCEL_SETTLE_MS.length, positions: 1 });
  function quotaWait(t) {
    warnOf("entry waiting for the next run - Webull call limit");
    if (!t.entryAttempts.length) t.note = QUOTA_NOTE;
  }
  if (!L.goLiveIso) {
    const built = Date.parse(acc.builtAtIso), floor = nowMs - GO_LIVE_LOOKBACK_MS;
    L.goLiveIso = new Date(Number.isFinite(built) && built <= nowMs ? Math.max(built - 30 * 60000, floor) : nowMs).toISOString();
  }
  // Share trades reach Webull from the first run with share orders on
  // (2026-11-19), by the same rule as the go-live cutoff: holdings the engines
  // bought before then stay on their own record and are never bought late.
  if (sz.shares && !L.sharesGoLiveIso) {
    const built = Date.parse(acc.builtAtIso), floor = nowMs - GO_LIVE_LOOKBACK_MS;
    L.sharesGoLiveIso = new Date(Number.isFinite(built) && built <= nowMs ? Math.max(built - 30 * 60000, floor) : nowMs).toISOString();
  }
  const engine = engineIndex(acc), session = isRegularSession(nowMs), cutoff = endOfDayWindow(nowMs), canTrade = placeOrders && session;
  let marketShut = false, snapshot = null, snapshotsHealthy = true, processingComplete = false;
  // One paper position per contract. A trade whose contract (any leg) another
  // tracked trade already holds or is buying is recorded, labeled with the
  // holder, and never bought a second time.
  const ENDED = ["skipped", "missed", "settled", "closed"];
  const shares = (a, b) => a !== b && a.symbol === b.symbol && a.legs?.length && b.legs?.length &&
    a.legs.some((l) => b.legs.some((x) => contractKey(a.symbol, l) === contractKey(b.symbol, x)));
  const liveOwner = (t) => Object.values(L.trades).find((o) => shares(o, t) && !ENDED.includes(o.state)) || null;
  const closingNow = (o) => !!engine.get(o.tradeId)?.closed || o.state === "exiting" || !!o.engineExitIso || !!o.mirrorCloseReason;
  function shareSkip(t, heldBy, heldById, holder = null) {
    t.state = "skipped";
    t.sharedContract = { heldBy: heldBy || "flagship", heldById: heldById || null };
    t.note = `Same contract is held by ${sourceName(heldBy)}${heldById ? ` (${heldById})` : ""}: recorded on its own track record, not bought twice.`;
    t.labels = [`Held by ${sourceName(heldBy)}: not bought twice`];
    if (holder && !(holder.sharedWith || []).some((x) => x.tradeId === t.tradeId)) (holder.sharedWith ||= []).push({ source: t.engine || "flagship", tradeId: t.tradeId, sinceIso: nowIso });
  }
  for (const [id, { e, closed }] of engine) {
    if (L.trades[id] || !e.contract || (Date.parse(e.entryDate) || 0) < Date.parse(L.goLiveIso)) continue;
    // A share trade waits for share orders to go live (never an earlier holding).
    if (isStockTrade(e) && !(Date.parse(L.sharesGoLiveIso) <= (Date.parse(e.entryDate) || 0))) continue;
    const t = newTrade(e, id, sz);
    if (!t.legs || !(t.engineEntryPrice > 0)) { t.state = "skipped"; t.note = "contract details missing or unsupported"; }
    else if (isStockTrade(t) && t.recordQty == null) { t.state = "skipped"; t.note = "share count missing on the record"; }
    else if (isStockTrade(t) && t.qtyBasis === "shares-over-max") { t.state = "skipped"; t.note = stockSizeNote(t); t.labels = [`Not bought: ${t.note}`]; }
    else if (e.noMirror) shareSkip(t, e.shared?.heldBy, e.shared?.heldById, e.shared?.heldById ? L.trades[e.shared.heldById] : null);
    else if (closed) { t.state = "missed"; t.note = "opened and closed between mirror runs"; }
    // The Owner controls (lib/owner-controls.mjs): Stop new trades, the Avoid
    // list and the account limits. The trade is logged as not bought, with
    // the reason, and is never bought later.
    else if (openGate && (t.ownerHold = openGate(e, L, t) || null)) { t.state = "skipped"; t.note = t.ownerHold; }
    else {
      // The engines flag a shared contract themselves; this catches what they
      // cannot see (Top Picks opening a contract an engine already holds).
      // A holder that is on its way out is not a holder: the new trade waits
      // for it to finish, then buys.
      const o = liveOwner(t);
      if (o && !closingNow(o)) shareSkip(t, o.engine || "flagship", o.tradeId, o);
    }
    L.trades[id] = t;
  }
  const trades = Object.values(L.trades);
  for (const t of trades) {
    t.requestedQty ??= 1; t.entryAttempts ||= []; t.exitAttempts ||= [];
    for (const a of [...t.entryAttempts, ...t.exitAttempts]) {
      a.quantity ??= 1;
      a.filledQty ??= a.status === "FILLED" ? a.quantity : 0;
    }
    updateQuantities(t);
    resolveOrderReview(t);
    if (t.state === "error") { t.needsReview = true; t.note ||= "Legacy execution error; check Webull."; }
  }
  // A stock split the engine record followed (lib/engines/split.mjs) while
  // this ledger is still in pre-split units: an open position is flagged
  // once (SPLIT_REVIEW) and held, with no orders, exit or settlement, until
  // it is checked by hand and the review cleared; an entry with nothing
  // filled or working is abandoned.
  const splitHeld = new Set();
  function markSplit(t) {
    if (ENDED.includes(t.state)) return;
    const split = splitSinceLedger(t, engine.get(t.tradeId)?.e);
    if (!split) return;
    if (t.splitFlagged === split) { if (t.needsReview && t.reviewCode === "SPLIT_REVIEW") splitHeld.add(t.tradeId); return; }
    t.splitFlagged = split;
    const working = t.entryAttempts.some((a) => !FINAL.has(a.status) || a.lookupFailed);
    if (!t.filledQty && t.state === "entering" && !working) { t.state = "skipped"; t.note = "A stock split since this trade was mirrored; entry abandoned."; t.labels = [`Skipped: ${t.note}`]; return; }
    attention(t, "Stock split since this trade was mirrored; Webull adjusts the position. Check its contracts and count by hand, then clear the review.", "SPLIT_REVIEW");
    splitHeld.add(t.tradeId);
  }
  function attention(t, note, code = null) { t.note = note; t.needsReview = true; t.reviewCode = code; }
  function brokerLegsMatch(t, legs, phase) {
    return legs.length === t.legs.length && legs.every(l => t.legs.some(x =>
      t.symbol === l.symbol && x.expiry === l.option_expire_date && x.type === l.option_type && x.strike === Number(l.strike_price) &&
      l.side === (phase === "exit" ? x.side === "BUY" ? "SELL" : "BUY" : x.side)));
  }
  function applyDetail(t, a, d) {
    if (!d?.status) throw new Error("order detail has no status");
    const qty = d.filledQty ?? (d.status === "FILLED" ? a.quantity : FINAL.has(a.status) && d.status === a.status ? a.filledQty : null);
    if (qty == null || !Number.isInteger(qty) || qty < a.filledQty || qty > a.quantity || (d.status === "FILLED" && qty !== a.quantity)) {
      attention(t, "Broker returned inconsistent fill quantities; check Webull."); a.lookupFailed = true; return;
    }
    if (!a.observations?.length) recordOrderObservation(a, "saved-state", eventIso());
    if (qty > 0) {
      if (d.brokerLegs && !brokerLegsMatch(t, d.brokerLegs, a.phase)) {
        a.lookupFailed = true; attention(t, "Confirmed broker order legs differ from the tracked contract; review required."); return;
      }
      const unchanged = qty === a.filledQty;
      a.filledPrice = d.filledPrice ?? (unchanged ? a.filledPrice : null) ?? null;
      a.filledIso = d.filledIso || (unchanged ? a.filledIso : null) || null;
      a.feeActual = d.feeActual ?? (unchanged ? a.feeActual : null) ?? null;
      if (d.brokerLegs) a.brokerLegs = d.brokerLegs;
    }
    a.status = d.status; a.filledQty = qty; a.lookupFailed = false; a.notFound = false; a.metadataUnavailable = false;
    if (d.brokerOrderId) a.brokerOrderId = d.brokerOrderId;
    recordOrderObservation(a, "broker-detail", eventIso());
    updateQuantities(t);
    resolveOrderReview(t);
  }
  async function refresh(t, phase, a = lastAttempt(t, phase)) {
    if (!a) return;
    if (FINAL.has(a.status)) {
      const recent = Number.isFinite(Date.parse(a.sentIso)) && etClock(Date.parse(a.sentIso)).date === etClock(nowMs).date;
      const active = t.openQty > 0 || ["entering", "exiting"].includes(t.state) || recent;
      const missing = a.filledQty > 0 && (a.filledPrice == null || active && (!a.filledIso || a.feeActual == null));
      if (!missing || a.lastEvidenceCheckIso && nowMs - Date.parse(a.lastEvidenceCheckIso) < 120000) return;
    }
    check();
    a.lastEvidenceCheckIso = nowIso;
    const terminalConfirmed = FINAL.has(a.status) && !a.lookupFailed;
    try { applyDetail(t, a, parseOrderDetail(await client.orderDetail(accountId, a.clientOrderId))); }
    catch (err) {
      // The call limit (or the lease) stopped the read before it was sent:
      // nothing is known about the order, so nothing is marked.
      if (["RUN_BUDGET", "LEASE_EXPIRED"].includes(err?.code)) throw err;
      // Failure to enrich a confirmed terminal order does not invalidate its
      // already-confirmed quantity or block a risk-reducing exit.
      if (terminalConfirmed) { a.metadataUnavailable = true; recordOrderObservation(a, "metadata-unavailable", eventIso()); await save(); return; }
      a.lookupFailed = true;
      // A missing response is not proof a previously submitted order never
      // filled. Only a journaled, unacknowledged intent may be replayed, using
      // its SAME client id and exact order body (never a new attempt).
      if (isOrderNotFoundError(err) && ["PREPARED", "UNKNOWN"].includes(a.status) && !a.filledQty) { a.notFound = true; a.lookupFailed = false; }
      else { errorOf("order status unavailable"); log.push(`${t.tradeId}: order status unavailable`); }
      recordOrderObservation(a, "lookup-unavailable", eventIso());
    }
    await save();
  }
  // Entries filled before broker legs were recorded have no proof to bind
  // their v3 position group, which paused the whole account. Re-read the
  // broker's own order detail for those legs; engine legs are never proof.
  async function proveLegs(t) {
    if (isStockTrade(t) || !(t.openQty > 0) || t.brokerPosition || t.needsReview || t.entryAttempts.some(a => a.filledQty > 0 && a.brokerLegs)) return;
    const a = t.entryAttempts.find(x => x.filledQty > 0 && FINAL.has(x.status) && !x.lookupFailed);
    if (!a) return;
    check();
    try {
      const d = parseOrderDetail(await client.orderDetail(accountId, a.clientOrderId));
      const qty = d?.filledQty ?? (d?.status === "FILLED" ? a.quantity : null);
      if (d?.status !== a.status || qty !== a.filledQty || !d.brokerLegs) { t.note = "Webull's order record has no confirmable legs, so the spread can't be matched to its position."; log.push(`${t.tradeId}: broker order has no confirmable legs`); }
      else if (!brokerLegsMatch(t, d.brokerLegs, "entry")) { a.lookupFailed = true; attention(t, "Confirmed broker order legs differ from the tracked contract; review required."); }
      else a.brokerLegs = d.brokerLegs;
    } catch { log.push(`${t.tradeId}: broker order legs unavailable`); }
    await save();
  }
  // Contracts the mirror holds or has sent orders for.
  const ownedKeys = () => new Set(trades.filter(t => t.legs?.length && (t.openQty > 0 || t.entryAttempts.length || t.exitAttempts.length) &&
    !["skipped", "missed", "settled", "closed"].includes(t.state)).flatMap(t => t.legs.map(l => contractKey(t.symbol, l))));
  // Shares a still-working stock order could fill before the positions read.
  const workingShares = () => {
    const w = {};
    for (const t of trades) {
      if (!isStockTrade(t)) continue;
      for (const [phase, list] of [["entry", t.entryAttempts], ["exit", t.exitAttempts]]) for (const a of list) {
        if (FINAL.has(a.status)) continue;
        const left = Math.max(0, (Number(a.quantity) || 0) - (Number(a.filledQty) || 0)), s = (w[t.symbol] ||= { up: 0, down: 0 });
        if (phase === "entry") s.up += left; else s.down += left;
      }
    }
    return w;
  };
  async function positions() {
    check();
    let stage = "positions-api";
    try {
      const response = await client.positions(accountId);
      stage = "positions-parse";
      bindNewFilledGroups(L, response);
      snapshot = parsePositions(response, positionBindings(L), { ownedKeys: ownedKeys() });
      snapshotsHealthy = true;
      // Expiry settlement is an exposure observation, never a fabricated fill.
      // Two flat snapshots a minute apart, no live orders, unchanged stock.
      for (const t of trades) {
        // Shares never expire; a share mismatch is a holdings alert instead.
        if (!t.openQty || !L.positionBaseline || isStockTrade(t) || splitHeld.has(t.tradeId)) continue;
        const expired = expiryControl(t, nowMs).expired;
        const pending = [...t.entryAttempts, ...t.exitAttempts].some((a) => !FINAL.has(a.status) || a.lookupFailed);
        const flat = t.legs.every((l) => !(snapshot.options[contractKey(t.symbol, l)] || 0) && !(L.positionBaseline.options[contractKey(t.symbol, l)] || 0));
        const stockSame = (snapshot.equities[t.symbol] || 0) === (L.positionBaseline.equities[t.symbol] || 0);
        if (flat && stockSame && !pending) {
          if (t.flatSinceIso && nowMs - Date.parse(t.flatSinceIso) >= 60000) {
            t.settledQty = (t.settledQty || 0) + t.openQty; updateQuantities(t); t.state = "settled"; t.needsReview = false;
            t.note = expired ? "Broker confirmed flat after expiry; settlement cash/P&L requires review. No closing fill was invented." : "Broker confirmed flat outside tracked closing fills; cash/P&L requires review. No closing fill was invented.";
          } else { t.flatSinceIso ||= nowIso; t.state = "settlement-pending"; }
        } else { t.flatSinceIso = null; if (!expired && t.state === "settlement-pending") t.state = t.engineExitIso || t.mirrorCloseReason ? "exiting" : "open"; if (expired) { t.state = "settlement-pending"; attention(t, "Expired exposure or changed stock holdings: check exercise/assignment in Webull."); } }
      }
      L.reconciliation = reconcilePositions(L, snapshot, eventIso(), { workingShares: workingShares() });
    } catch (err) {
      if (["RUN_BUDGET", "LEASE_EXPIRED"].includes(err.code)) throw err;
      snapshotsHealthy = false;
      L.reconciliation = { checkedAtIso: nowIso, status: "unavailable", alerts: [stage === "positions-api" ? "Broker positions request failed; orders paused." : "Broker position schema or group direction is unverified; orders paused."],
        failure: { stage, code: err.code || (stage === "positions-parse" ? "POSITION_SCHEMA" : "POSITIONS_REQUEST_FAILED"), status: err.status ?? null,
          // Parse errors are fixed strings (no broker data); API errors may echo the broker, so they stay out.
          ...(stage === "positions-parse" ? { reason: String(err.message || "").slice(0, 120) } : {}) }, blockedTradeIds: trades.map((t) => t.tradeId) };
      errorOf(stage === "positions-parse" ? "positions not readable" : "positions unavailable");
    }
    await save();
  }
  const aligned = (t) => snapshotsHealthy && !L.reconciliation?.blockedTradeIds?.includes(t.tradeId) &&
    ![...t.entryAttempts, ...t.exitAttempts].some(a => a.lookupFailed);
  async function cancel(t, phase) {
    const a = lastAttempt(t, phase);
    if (!a || FINAL.has(a.status)) return true;
    if (a.lookupFailed || a.notFound || ["PREPARED", "UNKNOWN"].includes(a.status)) return false;
    // Room for the cancel, its reads and the positions check, or the run
    // stops here and the order keeps working until the next run.
    if (!quota.fits({ cancelOrder: 1, orderDetail: 1 + CANCEL_SETTLE_MS.length, positions: 1 })) throw quotaStop("cancelOrder");
    check(); a.cancelRequestedIso ||= nowIso; a.lastCancelRequestedIso = nowIso;
    recordOrderObservation(a, "cancel-request", eventIso()); await save(); check();
    try { await client.cancelOrder(accountId, a.clientOrderId); }
    catch (err) { if (["RUN_BUDGET", "LEASE_EXPIRED"].includes(err?.code)) throw err; /* A fill can win the cancel race. Only the subsequent detail decides. */ }
    await refresh(t, phase);
    for (const ms of CANCEL_SETTLE_MS) {
      if (a.lookupFailed || FINAL.has(a.status) || clock() - started + ms + 5000 >= budgetMs) break;
      await pause(ms); check(); await refresh(t, phase);
    }
    if (a.lookupFailed || !FINAL.has(a.status)) {
      a.status = "CANCEL_FAILED"; a.cancelFails = (a.cancelFails || 0) + 1;
      if (a.cancelFails >= MAX_CANCEL_FAILS && (!t.needsReview || t.reviewCode === "CANCEL_UNCONFIRMED")) attention(t, `couldn't confirm the ${phase} order was cancelled; check Webull by hand`, "CANCEL_UNCONFIRMED");
      errorOf("cancel unconfirmed"); await save(); return false;
    }
    if (a.status === "CANCELLED") summary.cancelled++;
    await positions(); // captures fills that happened while cancelling
    return true;
  }
  async function submit(t, a) {
    if (a.phase === "entry" && t.entrySource === "manual") throw Object.assign(new Error("a manual entry cannot be replayed by the mirror"), { code: "MANUAL_ENTRY_REPLAY" });
    // The PREPARED intent is already saved: from here the run only stops for
    // a lost lease (guard), never for the time budget, so a budget stop can't
    // leave an unsent order that pauses every entry (2026-11-23). The order
    // call's quota was checked before the intent was written.
    guard(); recordOrderObservation(a, "submission-request", eventIso()); await save(); guard(); // durable intent BEFORE the broker mutation
    if (!isRegularSession(eventMs())) return;
    try {
      await client.placeOrder(accountId, [a.order]);
      a.status = "SENT"; a.notFound = false; summary.placed++;
    } catch (err) {
      if (isMarketClosedError(err)) { a.status = "REJECTED"; a.marketClosed = true; marketShut = true; summary.note = "Webull says the options market is closed"; }
      else {
        // Timeouts/5xx/duplicates are ambiguous. Do not advance the attempt id.
        a.status = "UNKNOWN"; a.error = "submission not acknowledged";
        await refresh(t, a.phase);
        if (a.status === "UNKNOWN" || a.lookupFailed) errorOf("submission not acknowledged");
        if (a.notFound && Number(err.status) >= 400 && Number(err.status) < 500 && !/duplicate/i.test(String(err.message))) { a.status = "REJECTED"; a.notFound = false; }
      }
    }
    recordOrderObservation(a, "submission-result", eventIso()); await save();
  }
  async function recover(t, phase, closing) {
    const a = lastAttempt(t, phase);
    if (!a || !["PREPARED", "UNKNOWN"].includes(a.status)) return false;
    if (a.notFound && a.order && canTrade && aligned(t) && !marketShut) {
      // Entry recovery on/after a close signal could increase exposure; leave
      // the uncertain intent for manual review rather than buying to unwind.
      if (phase === "entry" && (closing || !entrySessionMatches(t, nowMs) || t.manualEntryExpected)) attention(t, "Unacknowledged entry outside its eligible session or after a close signal; verify its client order ID in Webull.");
      else if (quota.fits({ placeOrder: 1, orderDetail: 1 })) await submit(t, a);
    }
    return true;
  }
  // Cash buying power, read once per run on the first opening order, less what
  // this run's earlier opening orders tie up.
  let cash = null, committed = 0;
  async function cashLeft() {
    if (!cash) {
      cash = { power: null };
      if (typeof client.balance !== "function") warnOf("balance read failed - cash not checked");
      else {
        check();
        try {
          const r = await client.balance(accountId);
          L.balanceShape = balanceShape(r);
          cash.power = parseCashPower(r);
          if (cash.power == null) warnOf("no cash field in the balance reply - cash not checked");
        } catch (err) {
          if (["RUN_BUDGET", "LEASE_EXPIRED"].includes(err.code)) throw err;
          warnOf("balance read failed - cash not checked");
        }
        check();
      }
    }
    return cash.power == null ? null : cash.power - committed;
  }
  async function place(t, phase, limit, why, quote, plan = null) {
    if (!canTrade || !isRegularSession(eventMs()) || marketShut || !aligned(t)) return;
    if (phase === "entry" && t.entrySource === "manual") return;
    if (phase === "entry" && (L.reconciliation.status !== "matched" || trades.some((x) => x.needsReview || [...x.entryAttempts, ...x.exitAttempts].some((a) => a.lookupFailed || ["UNKNOWN", "PREPARED"].includes(a.status))))) {
      if (!t.entryAttempts.length) t.note = WAIT_NOTE;
      return;
    }
    // Never trade into a contract held outside the mirror: ownership would become ambiguous.
    if (phase === "entry" && !t.filledQty && !t.entryAttempts.length && (snapshot?.external || []).some(g => t.legs.some(l => g.keys.includes(contractKey(t.symbol, l))))) {
      finishEntry(t, "shares a contract with a position held outside the mirror"); return;
    }
    if (phase === "entry" && (t.note === WAIT_NOTE || t.note === QUOTA_NOTE)) t.note = null;
    if (phase === "entry" && !t.filledQty) {
      const o = liveOwner(t);
      if (o) { if (!t.entryAttempts.length) t.note = `${SHARED_WAIT} ${sourceName(o.engine)} (${o.tradeId}) ${closingNow(o) ? "is closing the same contract first" : "holds the same contract"}.`; return; }
      if (String(t.note || "").startsWith(SHARED_WAIT)) t.note = null;
    }
    const quantity = phase === "entry" ? t.requestedQty - t.filledQty : t.openQty;
    if (!Number.isInteger(quantity) || quantity < 1) return;
    // Webull's call limit: an entry waits for the next run; an exit never
    // waits behind entries, and with no order call left the run stops here,
    // before the intent is written.
    if (phase === "entry" ? !quota.fits(entryNeed()) : !quota.fits({ placeOrder: 1 })) {
      if (phase !== "entry") throw quotaStop("placeOrder");
      quotaWait(t); return;
    }
    const list = phase === "entry" ? t.entryAttempts : t.exitAttempts;
    const px = plan ? limit : roundTick(limit, { spread: t.legs.length > 1, nickel: list.some((a) => a.status === "REJECTED" && !a.marketClosed), ppind: t.contractCheck?.ppind ?? null });
    if (!(px > 0)) return;
    check(); const q = quote !== undefined ? quote : await quoteFn(t).catch(() => null); check();
    const n = list.length + 1, coid = clientOrderId(t.tradeId, phase, n, t.engine);
    const order = buildOrder(t, phase, px, coid, quantity);
    // Fee preview first (no broker change), so the cash check can count it.
    let fee, previewed = false;
    if (client.previewOrder) { check(); try { fee = parsePreviewFee(await client.previewOrder(accountId, [order])); previewed = true; } catch { /* unknown fees stay unknown */ } }
    let need = null;
    if (phase === "entry") {
      need = openingCash(t, px, quantity, fee);
      const left = await cashLeft();
      if (left != null && need != null && need > left) {
        // Never bought later: a skipped trade is done, a partly filled one
        // keeps what filled, and the end-of-day attempt does not revive it.
        t.cashHold = { needUsd: need, observedIso: eventIso() };
        warnOf("opening order held - not enough cash");
        if (!t.filledQty && !t.entryAttempts.length) { t.state = "skipped"; t.note = CASH_NOTE; t.labels = [`Not bought: ${CASH_NOTE}`]; }
        else finishEntry(t, `${t.filledQty ? "Rest of the entry" : "Entry"} not sent. ${CASH_NOTE}`);
        await save(); return;
      }
    }
    const a = { phase, n, quantity, filledQty: 0, clientOrderId: coid, limit: px, why, sentIso: eventIso(), status: "PREPARED", filledPrice: null, filledIso: null,
      bid: num(q?.bid), ask: num(q?.ask), spot: num(q?.spot), quoteSource: q?.source || "unknown", quoteObservedIso: q?.observedIso || nowIso,
      quoteTimestampIso: q?.quoteTimestampIso || null, executionPolicy: EXECUTION_POLICY,
      policyStage: plan?.stage || null, allowancePct: plan?.allowancePct ?? null, referencePrice: plan?.reference ?? null,
      emergency: !!plan?.emergency, order, ...(previewed ? { feeEst: fee } : {}) };
    recordOrderObservation(a, "prepared", eventIso());
    list.push(a); updateQuantities(t); await save();
    if (need != null) committed += need;
    await submit(t, a);
  }
  function finishEntry(t, reason) {
    if (t.filledQty > 0) { t.state = "open"; t.note = reason || null; summary.filled++; updateQuantities(t); }
    else {
      const block = t.lastExecutionBlock?.phase === "entry" ? ` ${t.lastExecutionBlock.reason}` : "";
      t.state = "missed"; t.note = (reason || "Entry unfilled.") + block; t.labels = [`Missed: ${t.note}`]; summary.missed++;
    }
  }
  async function pricePlan(t, phase, stage, options = {}) {
    check(); const q = await quoteFn(t).catch(() => null); check();
    const list = phase === "entry" ? t.entryAttempts : t.exitAttempts;
    const plan = executionPrice(t, { phase, stage, quote: q,
      nickel: list.some(a => a.status === "REJECTED" && !a.marketClosed), ...options });
    if (!plan) {
      const decision = { phase, stage: options.emergency ? "emergency-exit" : stage, observedIso: eventIso(),
        reason: !q ? "Quote unavailable; no order sent." : "Quote or net price invalid; no order sent.",
        bid: num(q?.bid), ask: num(q?.ask), quoteSource: q?.source || "unknown" };
      t.executionDecisions ||= []; t.executionDecisions.push(decision); t.lastExecutionBlock = decision;
      t.note = `${phase === "entry" ? "Entry" : "Exit"} needs a usable quote and valid net price; no order sent.`; return null;
    }
    if (t.lastExecutionBlock?.phase === phase) t.lastExecutionBlock = null;
    return { q, plan };
  }
  try {
    // Refresh known orders before comparing holdings, including errored trades.
    for (const t of trades.slice().sort((a, b) => String(a.lastRefreshedIso || "").localeCompare(String(b.lastRefreshedIso || "")))) {
      for (const phase of ["entry", "exit"]) for (const a of (phase === "entry" ? t.entryAttempts : t.exitAttempts).slice().reverse()) await refresh(t, phase, a);
      t.lastRefreshedIso = nowIso;
    }
    for (const t of trades) await proveLegs(t);
    // Before the position check: it would read a split option's old strikes
    // as flat and settle the trade while Webull still holds the adjusted one.
    for (const t of trades) markSplit(t);
    await positions();
    // Webull's contract list for every option trade about to send its first
    // entry order, in one lookup (lib/webull-contracts.mjs).
    if (contractCheck && canTrade) await contractCheck.prefetch(trades.filter((t) => t.state === "entering" && !t.entryAttempts.length && !t.contractCheck && !isStockTrade(t) && t.entrySource !== "manual"));
    const ordered = trades.slice().sort((a, b) => Number(!!b.openQty) - Number(!!a.openQty) || String(a.lastProcessedIso || "").localeCompare(String(b.lastProcessedIso || "")));
    for (const t of ordered) {
      check();
      if (!t.legs?.length && !isStockTrade(t) || ["skipped", "settled"].includes(t.state)) continue;
      // The engines' record could not be read this run: their trades are held
      // as they are (orders were still polled above), never read as "missing".
      if (enginesUnavailable && t.engine && !engine.has(t.tradeId)) { summary.note ||= "Engine record unavailable; engine trades held this run."; continue; }
      if (t.state === "missed") {
        const eng = engine.get(t.tradeId);
        if (cutoff.due && entrySessionMatches(t, nowMs) && eng && !eng.closed && !t.filledQty && !t.needsReview && !t.cashHold && t.contractCheck?.ok !== false && t.entrySource !== "manual" && !t.entryAttempts.some(a => a.policyStage === "eod-entry")) t.state = "entering";
        else continue;
      }
      if (!Number.isInteger(t.requestedQty) || t.requestedQty < 1 || t.filledQty > t.requestedQty || t.closedQty + (t.settledQty || 0) > t.filledQty) { attention(t, "Invalid position quantity; check Webull."); continue; }
      const eng = engine.get(t.tradeId), expiry = isStockTrade(t) ? NO_EXPIRY : expiryControl(t, nowMs);
      // Flagged for a stock split (markSplit, before the position check): no
      // order of any kind until it is checked by hand.
      if (splitHeld.has(t.tradeId)) { t.lastProcessedIso = nowIso; continue; }
      if (t.engine && !t.setup && eng?.e?.setup) t.setup = String(eng.e.setup);
      t.expiryControl = expiry; t.lastProcessedIso = nowIso;
      if (t.filledQty > 0 && t.fillPrice == null && (!t.needsReview || t.reviewCode === "FILL_PRICE_UNCONFIRMED")) attention(t, "Confirmed contracts have no execution price; P&L remains unknown.", "FILL_PRICE_UNCONFIRMED");
      if (canTrade && !aligned(t)) {
        // A holdings mismatch must not leave a known working order capable
        // of adding exposure while replacement orders are blocked.
        for (const phase of ["entry", "exit"]) {
          const a = lastAttempt(t, phase);
          if (a && !FINAL.has(a.status)) await cancel(t, phase);
        }
      }
      // An absent engine row alone is insufficient evidence to liquidate.
      if (!eng && t.openQty > 0) attention(t, "Trade missing from engine record; broker exposure retained for review.");
      if (!eng && t.state === "entering" && !expiry.due) {
        const pending = lastAttempt(t, "entry");
        if (pending && !FINAL.has(pending.status) && (!canTrade || !await cancel(t, "entry"))) continue;
        if (t.filledQty) { t.state = "open"; attention(t, "Trade missing from engine record; broker exposure retained for review."); }
        else finishEntry(t, "Trade missing from engine record; remaining entry abandoned.");
        continue;
      }
      const closing = !!eng?.closed || expiry.due || t.state === "exiting";
      if (!expiry.known) attention(t, "Expiry calendar unavailable; new entry blocked, review closing exposure.");
      if (eng?.closed && t.engineExitIso == null) {
        t.engineExitIso = eng.e.exitDate || nowIso; t.engineCloseReason = eng.e.status;
        // A share trade's record result is net of its 0.1% costs, so the
        // stock's own closing price (exitMid) is the true reference to sell at.
        t.engineExitPrice = r2(isStockTrade(t) && num(eng.e.exitMid) > 0 ? num(eng.e.exitMid) : markPrice(eng.e)); t.enginePnlPct = r1(num(eng.e.optionPnlPct));
      }
      if (expiry.due && !eng?.closed) { t.mirrorCloseReason = "expiry-control"; t.mirrorCloseIso ||= nowIso; }
      if (await recover(t, "entry", closing)) continue;
      if (t.state === "entering" || (!FINAL.has(lastAttempt(t, "entry")?.status) && lastAttempt(t, "entry"))) {
        const a = lastAttempt(t, "entry");
        if (!session && cutoff.known && cutoff.minute >= cutoff.closeMinute && (!a || FINAL.has(a.status))) {
          finishEntry(t, t.filledQty ? "Partially filled; session ended." : "Session ended without a confirmed entry fill.");
          continue;
        }
        if (t.filledQty === t.requestedQty || closing) {
          if (a && !FINAL.has(a.status) && (!canTrade || !await cancel(t, "entry"))) continue;
          finishEntry(t, !closing || t.filledQty >= t.requestedQty ? null
          : t.entryAttempts.length ? "Remaining entry cancelled for close/expiry."
          : `engine closed the pick before an order was sent${t.note === WAIT_NOTE ? " (orders were paused by the broker holdings check)" : ""}`);
        }
        else if (canTrade && aligned(t) && !t.needsReview) {
          if (t.entrySource === "manual" || t.manualEntryExpected) continue;
          if (!entrySessionMatches(t, nowMs)) {
            if (a && !FINAL.has(a.status) && !await cancel(t, "entry")) continue;
            finishEntry(t, "Entry session ended; no automatic next-day entry."); continue;
          }
          if (endOfDayOnly && !cutoff.due) continue;
          const rejects = t.entryAttempts.filter((x) => x.status === "REJECTED" && !x.marketClosed).length;
          if (rejects >= 3) { attention(t, "Repeated entry rejection; review in Webull."); continue; }
          const normal = t.entryAttempts.filter(x => !x.marketClosed && x.policyStage !== "eod-entry");
          const eodAttempt = t.entryAttempts.find(x => x.policyStage === "eod-entry");
          const stage = cutoff.due ? "eod-entry" : normal.length;
          // The final working order remains live. Polling it is not a new try.
          if (eodAttempt || stage !== "eod-entry" && normal.length >= ENTRY_MAX_ATTEMPTS) {
            if (a && !FINAL.has(a.status)) continue;
            finishEntry(t, t.filledQty ? "Partially filled; remainder unfilled." : "Entry allowance exhausted; awaiting the capped end-of-day attempt."); continue;
          }
          if (a && !FINAL.has(a.status) && !cutoff.due && nowMs - Date.parse(a.sentIso) < ENTRY_DWELL_MS) continue;
          // Webull's call limit (2026-11-23): no room for this entry (or for a
          // re-price, which cancels first) this run, so the working order, if
          // any, keeps working and the rest waits for the next run.
          if (!quota.fits(a && !FINAL.has(a.status) ? repriceNeed() : entryNeed())) { quotaWait(t); continue; }
          // Contract check before the first entry order (WEBULL_CONTRACT_CHECK):
          // a contract Webull does not list as tradable gets no order. An
          // unreadable list sends the order as before.
          if (contractCheck && !t.entryAttempts.length && !t.contractCheck && !isStockTrade(t)) {
            check(); const v = await contractCheck.check(t); check();
            if (v?.ok === false) {
              t.contractCheck = v; dataOf(`not tradable at Webull - ${v.reason}`);
              finishEntry(t, `${NOT_TRADABLE_PREFIX}: ${v.reason}; no order sent.`); await save(); continue;
            }
            if (v?.ok === true) { t.contractCheck = v; dataOf(v.ppind === false ? "contract checked - standard price step" : "contract checked"); }
            else warnOf(`${v?.reason === "contract list unconfirmed" ? "contract list unconfirmed" : "contract list unavailable"} - contract not checked`);
          }
          const priced = await pricePlan(t, "entry", stage);
          if (!priced) continue;
          if (a && !FINAL.has(a.status)) {
            const atTouch = priced.plan.buying ? a.limit >= priced.q.ask : a.limit <= priced.q.bid;
            if (atTouch && stage !== "eod-entry") continue;
            if (!await cancel(t, "entry") || !aligned(t) || t.filledQty === t.requestedQty) { if (t.filledQty === t.requestedQty) finishEntry(t); continue; }
          }
          await place(t, "entry", priced.plan.limit, stage === "eod-entry" ? "End-of-day entry: 5% ceiling" : `Entry: ${priced.plan.allowancePct}% allowance`, priced.q, priced.plan);
          continue;
        } else {
          if (canTrade && !aligned(t) && !t.needsReview && !t.entryAttempts.length) t.note = WAIT_NOTE;
          continue;
        }
      }
      if (t.filledQty > 0 && t.closedQty === t.filledQty) {
        if (t.state !== "closed") summary.closed++;
        t.state = "closed";
        if ((t.fillPrice == null || t.closeFillPrice == null) && !t.needsReview) attention(t, "Confirmed closing contracts have no complete execution price; P&L remains unknown.", "FILL_PRICE_UNCONFIRMED");
        t.paperPnlPct = paperPnlPct(t); continue;
      }
      if (!t.openQty) continue;
      if (expiry.expired) { t.state = "settlement-pending"; attention(t, "Expired exposure requires broker settlement/assignment review."); continue; }
      if (t.flatSinceIso || !closing) { if (t.state !== "settlement-pending") t.state = "open"; continue; }
      t.state = "exiting";
      if (await recover(t, "exit", true)) continue;
      if (!canTrade || !aligned(t)) continue;
      if (endOfDayOnly && !cutoff.due) continue;
      const today = etClock(nowMs).date;
      const attemptsToday = t.exitAttempts.filter((a) => !a.marketClosed && (!Number.isFinite(Date.parse(a.sentIso)) || etClock(Date.parse(a.sentIso)).date === today)).length;
      if (attemptsToday >= EXIT_MAX_ATTEMPTS && !cutoff.due) {
        // Keep the last DAY limit working and keep polling fills. A new
        // session restores the retry budget so expiry controls don't give up
        // permanently after one illiquid hour.
        attention(t, "Exit still unfilled after 12 attempts this session; check Webull. Last DAY order remains monitored."); continue;
      }
      const pendingExit = lastAttempt(t, "exit");
      if (pendingExit && !FINAL.has(pendingExit.status) && (pendingExit.emergency || nowMs - Date.parse(pendingExit.sentIso) < ENTRY_DWELL_MS && !cutoff.due)) continue;
      const normalExits = t.exitAttempts.filter(a => !a.marketClosed && !a.emergency);
      const stage = Math.min(normalExits.length, 1);
      const priced = await pricePlan(t, "exit", stage, { emergency: cutoff.due, expiry: expiry.due && !cutoff.due });
      if (!priced) continue;
      if (pendingExit && !FINAL.has(pendingExit.status) && !cutoff.due && !expiry.due) {
        const atTouch = priced.plan.buying ? pendingExit.limit >= priced.q.ask : pendingExit.limit <= priced.q.bid;
        if (atTouch || normalExits.length >= 2) continue;
      }
      if (!await cancel(t, "exit")) continue;
      if (!t.openQty) {
        t.state = "closed";
        if ((t.fillPrice == null || t.closeFillPrice == null) && !t.needsReview) attention(t, "Confirmed closing contracts have no complete execution price; P&L remains unknown.", "FILL_PRICE_UNCONFIRMED");
        t.paperPnlPct = paperPnlPct(t); summary.closed++; continue;
      }
      if (!aligned(t)) continue;
      await place(t, "exit", priced.plan.limit, cutoff.due ? "Emergency end-of-day exit: price allowance removed" : expiry.due ? "Expiry control: executable quote" : `Exit: ${priced.plan.allowancePct}% allowance`, priced.q, priced.plan);
    }
    processingComplete = true;
  } catch (err) {
    if (err.code !== "RUN_BUDGET") throw err;
    summary.note = err.quota ? "Webull call limit reached; remaining reconciliation continues next run." : "Time budget reached; remaining reconciliation continues next run.";
    // One copy of the alert, so a second stopped run in a row still counts as
    // a single "incomplete" alert and the window keeps following up.
    L.reconciliation = { ...L.reconciliation, status: "incomplete", alerts: [...new Set([...(L.reconciliation?.alerts || []), "Reconciliation incomplete; a build follow-up or manual reconciliation is needed."])] };
  }
  if (endOfDayOnly && cutoff.known && cutoff.open && !session && cutoff.minute >= cutoff.closeMinute) for (const t of trades) {
    if (t.needsReview && !["EOD_ORDER_UNCONFIRMED", "EOD_EXIT_UNFILLED"].includes(t.reviewCode)) continue;
    if (t.openQty > 0 && (t.engineExitIso || t.mirrorCloseReason)) attention(t, "Session ended with a signaled exit still unfilled; broker exposure remains open.", "EOD_EXIT_UNFILLED");
    if ([...t.entryAttempts, ...t.exitAttempts].some(a => !FINAL.has(a.status))) attention(t, "Session ended with an order outcome unconfirmed; inspect Webull.", "EOD_ORDER_UNCONFIRMED");
  }
  const review = trades.filter((t) => t.needsReview).map((t) => `${t.symbol}: ${t.note}`);
  const baseAlerts = new Set(L.reconciliation?.alerts || []);
  // Kinds of review for the public workflow log: a fixed label and the source
  // (Top Picks or an engine), never a ticker, order ID or account detail.
  const kinds = trades.filter((t) => t.needsReview).map((t) => ({ kind: REVIEW_KIND_LABELS[t.reviewCode] || "trade needs a check", source: sourceName(t.engine) }));
  for (const t of trades) if ([...t.entryAttempts, ...t.exitAttempts].some((a) => a.lookupFailed || ["UNKNOWN", "PREPARED"].includes(a.status))) {
    review.push(`${t.symbol}: order acknowledgment/status unverified; entries paused.`);
    kinds.push({ kind: "order status unverified", source: sourceName(t.engine) });
  }
  if (review.length) L.reconciliation = { ...L.reconciliation, status: "attention", alerts: [...new Set([...(L.reconciliation?.alerts || []), ...review])] };
  if (baseAlerts.size) kinds.push(...[...baseAlerts].filter((a) => !review.includes(a)).map(() => ({ kind: "account holdings check", source: null })));
  summary.alerts = L.reconciliation?.alerts?.length || 0;
  summary.reviewKinds = kinds.length ? countReviewKinds(kinds) : null;
  // Webull calls this run by endpoint (counts only, for the workflow log).
  const callsUsed = quota.used();
  if (Object.keys(callsUsed).length) summary.webullCalls = callsUsed;
  summary.followUpNeeded = !!(canTrade && (!summary.alerts || L.reconciliation?.status === "incomplete" && summary.alerts === 1) && trades.some((t) =>
    [...t.entryAttempts, ...t.exitAttempts].some((a) => !FINAL.has(a.status)) ||
    (t.state === "entering" && t.filledQty < t.requestedQty) || (t.state === "exiting" && t.openQty > 0)));
  // Why the window is still pending, in fixed words (2026-11-19). A limit
  // order still working inside its 2% / 4% allowance is the normal state of
  // the price ladder: it stays live until it fills or the end-of-day window
  // gives it the 5% ceiling, so it is named apart from a real fault.
  if (summary.followUpNeeded) {
    const pk = {};
    const add = (k) => { pk[k] = (pk[k] || 0) + 1; };
    for (const t of trades) {
      const working = (list) => list.some((a) => !FINAL.has(a.status) && !["PREPARED", "UNKNOWN", "CANCEL_FAILED"].includes(a.status) && !a.lookupFailed);
      if (t.state === "entering" && working(t.entryAttempts)) add("entry order working inside its price allowance");
      else if (t.state === "exiting" && working(t.exitAttempts)) add("exit order working");
      else if ([...t.entryAttempts, ...t.exitAttempts].some((a) => !FINAL.has(a.status))) add("order not yet confirmed");
      else if (t.state === "entering" && t.filledQty < t.requestedQty) add(t.entryAttempts.length ? "entry waiting to re-price" : "entry waiting for a usable quote");
      else if (t.state === "exiting" && t.openQty > 0) add("exit waiting to re-price");
    }
    summary.pendingKinds = Object.keys(pk).length ? pk : null;
  }
  if (cutoff.due && canTrade && processingComplete && snapshotsHealthy && endOfDayWindow(eventMs()).due) L.lastEndOfDayDeadlineIso = eventIso();
  const observedDeadline = Date.parse(L.lastEndOfDayDeadlineIso);
  summary.endOfDayDeadlineObserved = Number.isFinite(observedDeadline) && etClock(observedDeadline).date === etClock(nowMs).date && endOfDayWindow(observedDeadline).due;
  if (endOfDayOnly && cutoff.known && cutoff.open && !session && cutoff.minute >= cutoff.closeMinute) {
    L.lastEndOfDayAudit = { checkedAtIso: nowIso, deadlineObserved: summary.endOfDayDeadlineObserved, incomplete: !processingComplete || !snapshotsHealthy,
      unresolvedExits: trades.filter(t => t.openQty > 0 && (t.engineExitIso || t.mirrorCloseReason)).length,
      unconfirmedOrders: trades.reduce((n, t) => n + [...t.entryAttempts, ...t.exitAttempts].filter(a => !FINAL.has(a.status) || a.lookupFailed).length, 0) };
  }
  L.engineSnapshotIso = acc.builtAtIso ?? null;
  L.lastRunIso = nowIso; L.runs = [{ ...summary, session }, ...L.runs].slice(0, RUNS_KEPT);
  await save();
  return { ledger: L, summary: { ...summary, session }, log };
}

// --- Rows for "Your fills vs the record" ---------------------------------------

// "BUY 2026-12-18 150 CALL" per leg, or "120 shares" for a share trade.
export function positionText(t) {
  if (isStockTrade(t)) return `${t.requestedQty ?? "?"} shares`;
  return (t.legs || []).map((l) => `${l.side} ${l.expiry} ${l.strike} ${l.type}`).join(" / ");
}

const ET_TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", month: "2-digit", day: "2-digit", year: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
function etStamp(iso) {
  const d = new Date(iso);
  return iso && !Number.isNaN(d.getTime()) ? ET_TIME.format(d).replace(",", "") : "";
}

// Ledger trades -> rows in the picks-fills shape (lib/track-record-fills.mjs
// FILL_COLUMNS), account "Webull paper". Trades still waiting on their first
// order are left out.
export function ledgerToFillRows(ledger) {
  const rows = [];
  for (const t of Object.values(ledger?.trades || {})) {
    if (t.state === "entering" && !t.entryAttempts?.length) continue;
    const missed = t.state === "missed" || t.state === "skipped";
    const filledQty = t.filledQty ?? (t.fillPrice != null ? 1 : 0);
    const closedQty = t.closedQty ?? (t.closeFillPrice != null ? 1 : 0);
    const entryA = (t.entryAttempts || []).filter((a) => a.status !== "REJECTED" && (t.entrySource !== "manual" || a.source === "manual"));
    const exitA = t.exitAttempts || [];
    const fb = feeBreakdown(t);
    const row = {
      trade_id: t.tradeId,
      // `engine` is the engine's id, empty for Top Picks (what the page
      // filters on); `made_by` is the same fact as a name, never empty.
      engine: t.engine || "",
      made_by: sourceName(t.engine),
      setup: t.setup || "",
      source: "webull-paper",
      account: t.entrySource === "manual" ? `${ACCOUNT_LABEL} (manual entry)` : ACCOUNT_LABEL,
      symbol: t.symbol,
      side: t.side,
      structure: t.structure,
      legs: positionText(t),
      qty: filledQty || t.requestedQty || 1,
      requested_qty: t.requestedQty ?? 1,
      fill_outcome: fillOutcome(t),
      instrument: isStockTrade(t) ? "stock" : "option",
      mingstreet_run_time_et: etStamp(t.engineEntryIso),
      mingstreet_entry_mid: t.engineEntryPrice,
      order_sent_time_et: t.entrySource === "manual" ? "" : etStamp(entryA[0]?.sentIso),
      stock_price_at_order: entryA[0]?.spot ?? null,
      bid_at_order: entryA[0]?.bid ?? null,
      ask_at_order: entryA[0]?.ask ?? null,
      order_type: t.entrySource === "manual" ? entryA[0]?.order?.order_type || "unknown" : "LIMIT",
      limit_steps: entryA.length || null,
      fill_price: t.fillPrice,
      fill_time_et: etStamp(t.fillIso),
      skipped: missed ? "yes" : "",
      skip_reason: missed ? (t.note || "") : "",
      close_reason_feed: t.engineCloseReason || "",
      feed_exit_pnl_pct: t.enginePnlPct,
      close_order_time_et: etStamp(exitA[0]?.sentIso),
      bid_at_close: exitA[0]?.bid ?? null,
      ask_at_close: exitA[0]?.ask ?? null,
      close_fill_price: closedQty === filledQty && filledQty > 0 ? t.closeFillPrice : null,
      close_fill_time_et: etStamp(t.closeFillIso),
      fees: t.fees ?? null,
      // Real fees from Webull's order records vs the order previews' estimate
      // (2026-11-19, lib/webull-fees.mjs). `fees` above uses real where known.
      fees_actual: fb.actual, fees_estimated: fb.estimated, fee_basis: fb.basis || "",
      webull_contract_check: t.contractCheck ? (t.contractCheck.ok === false ? `not tradable: ${t.contractCheck.reason}` : t.contractCheck.ppind === false ? "listed; standard price step" : "listed") : "",
      close_trigger: exitA.length ? exitA[exitA.length - 1].why || "" : "",
      notes: [...new Set([...(t.labels || []), t.note, `state: ${t.state}`].filter(Boolean))].join("; "),
      execution_decisions_json: JSON.stringify(t.executionDecisions || []),
      entry_source: t.entrySource || "automatic", entry_price_difference_pct: diffPct(t.fillPrice, t.engineEntryPrice),
      automatic_entry_outcome: t.automaticEntryOutcome || "", automatic_entry_attempt_count: t.automaticEntryAttemptCount ?? entryA.length,
      entry_end_of_day: !!t.entryEndOfDayUsed, emergency_exit_used: !!t.emergencyExitUsed,
      emergency_exit_filled: !!t.emergencyExitFilled, exit_price_difference_pct: t.exitDiffPct,
      exit_slippage_pct: t.exitDiffPct == null ? null : isCredit(t.structure) ? t.exitDiffPct : -t.exitDiffPct,
    };
    row.your_pnl_pct = fillPnlPct(row);
    row.entry_slippage_pct = t.entrySource === "manual" ? null : entrySlippagePct(row);
    rows.push(row);
  }
  rows.sort((a, b) => String(b.mingstreet_run_time_et).localeCompare(String(a.mingstreet_run_time_et)));
  return rows;
}

// Ledger -> one compact object per mirrored trade for the Track Record's
// "Webull test" view (Owner-only GET). Everything the panels need, nothing
// about the account itself.
export function ledgerToTestTrades(ledger) {
  const out = [];
  for (const t of Object.values(ledger?.trades || {})) {
    const entryA = (t.entryAttempts || []).filter((a) => a.status !== "REJECTED" && (t.entrySource !== "manual" || a.source === "manual"));
    const exitA = (t.exitAttempts || []).filter((a) => a.status !== "REJECTED");
    const filledEntry = entryA.find((a) => a.status === "FILLED") || null;
    const filledExit = exitA.find((a) => a.status === "FILLED") || null;
    const fb = feeBreakdown(t);
    out.push({
      tradeId: t.tradeId, engine: t.engine || null, setup: t.setup || null, madeBy: sourceName(t.engine), symbol: t.symbol, side: t.side, structure: t.structure, state: t.state,
      sharedContract: t.sharedContract || null, sharedWith: t.sharedWith || null,
      entrySource: t.entrySource || "automatic",
      automaticEntryOutcome: t.automaticEntryOutcome || null, automaticEntryAttemptCount: t.automaticEntryAttemptCount ?? entryA.length,
      executionPolicy: t.executionPolicy || "legacy", entryEndOfDayUsed: !!t.entryEndOfDayUsed,
      emergencyExitUsed: !!t.emergencyExitUsed, emergencyExitFilled: !!t.emergencyExitFilled,
      instrument: isStockTrade(t) ? "stock" : "option", fillOutcome: fillOutcome(t),
      qtyBasis: t.qtyBasis || "one", recordQty: t.recordQty ?? null, riskPerContract: t.riskPerContract ?? null, stockRange: t.stockRange ?? null,
      requestedQty: t.requestedQty ?? 1, filledQty: t.filledQty ?? (t.fillPrice != null ? 1 : 0),
      closedQty: t.closedQty ?? (t.closeFillPrice != null ? 1 : 0), openQty: t.openQty ?? null,
      needsReview: !!t.needsReview, expiryControl: t.expiryControl ?? null, mirrorCloseReason: t.mirrorCloseReason ?? null,
      legs: positionText(t),
      engineEntryPrice: t.engineEntryPrice, engineEntryIso: t.engineEntryIso,
      entrySentIso: t.entrySource === "manual" ? null : entryA[0]?.sentIso || null,
      manualEntrySentIso: t.entrySource === "manual" ? entryA[0]?.sentIso || null : null,
      entryTries: t.entrySource === "manual" ? 0 : entryA.length,
      entryHow: t.entrySource !== "manual" && filledEntry ? (filledEntry.n === entryA[0]?.n ? "first" : "reprice") : null,
      entryBid: entryA[0]?.bid ?? null, entryAsk: entryA[0]?.ask ?? null, entrySpot: entryA[0]?.spot ?? null,
      fillPrice: t.fillPrice, fillIso: t.fillIso, entryDiffPct: t.entryDiffPct,
      engineExitPrice: t.engineExitPrice, engineExitIso: t.engineExitIso,
      engineCloseReason: t.engineCloseReason, enginePnlPct: t.enginePnlPct,
      exitSentIso: exitA[0]?.sentIso || null, exitTries: exitA.length,
      exitBid: exitA[0]?.bid ?? null, exitAsk: exitA[0]?.ask ?? null,
      closeFillPrice: t.closeFillPrice, closeFillIso: t.closeFillIso, exitDiffPct: t.exitDiffPct,
      exitHow: filledExit?.why || null,
      paperPnlPct: t.paperPnlPct, fees: t.fees ?? null,
      feesActual: fb.actual, feesEstimated: fb.estimated, feeBasis: fb.basis,
      contractCheck: t.contractCheck ? { ok: t.contractCheck.ok, reason: t.contractCheck.reason ?? null, ppind: t.contractCheck.ppind ?? null, checkedIso: t.contractCheck.checkedIso ?? null } : null,
      labels: t.labels || [], note: t.note || null,
      decisions: (t.executionDecisions || []).map(d => ({ phase: d.phase, stage: d.stage, observedIso: d.observedIso, reason: d.reason, bid: d.bid, ask: d.ask, quoteSource: d.quoteSource })),
      attempts: [...(t.entryAttempts || []), ...(t.exitAttempts || [])].map(a => ({ phase: a.phase, n: a.n, orderPrefix: orderIdPrefix(a.clientOrderId),
        source: a.source || "automatic", stage: a.policyStage || "legacy", sentIso: a.sentIso, status: a.status,
        quantity: a.quantity, filledQty: a.filledQty, limit: a.limit, filledPrice: a.filledPrice ?? null, filledIso: a.filledIso ?? null,
        bid: a.bid ?? null, ask: a.ask ?? null, allowancePct: a.allowancePct ?? null, referencePrice: a.referencePrice ?? null,
        cancelRequestedIso: a.cancelRequestedIso ?? null, lastCancelRequestedIso: a.lastCancelRequestedIso ?? null, quoteSource: a.quoteSource || "unknown",
        quoteObservedIso: a.quoteObservedIso ?? null, quoteTimestampIso: a.quoteTimestampIso ?? null, emergency: !!a.emergency,
        brokerOrderId: a.brokerOrderId ?? a.order?.order_id ?? null, feeActual: a.feeActual ?? null, feeEstimate: a.feeEst ?? null,
        feeSource: a.feeActual == null ? null : a.feeSource || "order-detail", feeLines: a.feeLines || null,
        observations: (a.observations || []).map(o => ({ kind: o.kind, observedIso: o.observedIso, status: o.status,
          filledQty: o.filledQty, filledPrice: o.filledPrice ?? null, filledIso: o.filledIso ?? null,
          feeActual: o.feeActual ?? null, brokerOrderId: o.brokerOrderId ?? null })) })),
    });
  }
  out.sort((a, b) => String(b.engineEntryIso || "").localeCompare(String(a.engineEntryIso || "")));
  return out;
}

const csvCell = (v) => {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

// The rows as a CSV with the trade-log template's columns, plus the mirror's
// computed P&L and entry gap.
export function fillRowsToCsv(rows) {
  const cols = [...FILL_COLUMNS, "requested_qty", "fill_outcome", "instrument", "your_pnl_pct", "entry_slippage_pct", "entry_source", "entry_price_difference_pct", "entry_end_of_day", "emergency_exit_used", "emergency_exit_filled", "exit_slippage_pct", "exit_price_difference_pct", "automatic_entry_outcome", "automatic_entry_attempt_count", "execution_decisions_json", "fees_actual", "fees_estimated", "fee_basis", "webull_contract_check", "setup", "engine", "made_by"];
  return [cols.join(","), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))].join("\n") + "\n";
}

export function orderAttemptsToCsv(ledger) {
  const cols = ["trade_id", "symbol", "phase", "attempt", "source", "policy_stage", "broker_status", "requested_qty", "cumulative_filled_qty",
    "modeled_price", "limit_price", "average_fill_price", "fill_price_difference_pct", "adverse_slippage_pct", "broker_order_id",
    "sent_time_iso", "fill_time_iso", "emergency", "end_of_day_entry", "actual_fees", "estimated_fees", "bid", "ask", "quote_source",
    "quote_fetched_iso", "first_cancel_requested_iso", "last_cancel_requested_iso", "observations_json", "fee_source", "engine", "made_by", "webull_order_prefix"];
  const rows = ledgerToTestTrades(ledger).flatMap(t => t.attempts.map(a => {
    const reference = a.referencePrice ?? (a.phase === "entry" ? t.engineEntryPrice : t.engineExitPrice);
    const gap = diffPct(a.filledPrice, reference), credit = isCredit(t.structure);
    const buying = a.phase === "entry" ? !credit : credit;
    return [t.tradeId, t.symbol, a.phase, a.n, a.source, a.stage, a.status, a.quantity, a.filledQty,
      reference, a.limit, a.filledPrice, gap, gap == null ? null : buying ? gap : -gap, a.brokerOrderId,
      a.sentIso, a.filledIso, a.emergency, a.stage === "eod-entry", a.feeActual, a.feeEstimate, a.bid, a.ask, a.quoteSource,
      a.quoteObservedIso, a.cancelRequestedIso, a.lastCancelRequestedIso, JSON.stringify(a.observations), a.feeSource || "", t.engine || "", sourceName(t.engine), a.orderPrefix];
  }));
  return [cols.join(","), ...rows.map(row => row.map(csvCell).join(","))].join("\n") + "\n";
}

// --- Live quotes ----------------------------------------------------------------

// quoteFn for runWebullMirror from lib/yahoo.mjs fetchContract: one Yahoo call
// per distinct leg per run, cached across retries. Returns the position's bid/ask per share in its opening direction:
// a long's own quote, a debit spread's net debit, a credit spread's net credit.
// fetchStock(symbol) -> { bid, ask, spot } (lib/yahoo.mjs fetchQuote) prices
// share trades: the stock's own bid/ask, one Yahoo call per symbol per run.
// Without it a share trade has no quote and sends no order.
export function makeQuoteFn(fetchContract, fetchStock = null) {
  const cache = new Map(), stocks = new Map();
  const stockQuote = async (symbol) => {
    if (!fetchStock) return null;
    if (!stocks.has(symbol)) stocks.set(symbol, Promise.resolve().then(() => fetchStock(symbol)));
    const q = await stocks.get(symbol);
    let b = num(q?.bid), a = num(q?.ask);
    // Yahoo answers 0 / 0 outside the session or for a halted name: no quote.
    if (b == null || a == null || !(b > 0) || !(a > 0) || b > a) return null;
    // A Yahoo book away from Yahoo's own last price prices at that last price
    // (review 2026-11-22; plain Yahoo is the fetcher when WEBULL_STOCK_QUOTES
    // is off). A Webull snapshot passed its own checks in lib/webull-quotes.mjs,
    // and a quote the fetcher already moved to the last price is left alone.
    let source = q?.source || "Yahoo stock quote";
    if (q?.source !== WEBULL_STOCK_SOURCE && !q?.lastOnly && yahooBookOff(q)) {
      const last = yahooLastPriceQuote(q);
      b = last.bid; a = last.ask; source = `${source} (bid/ask away from its last price; priced at the last price)`;
    }
    return { bid: b, ask: a, spot: num(q?.spot), source, observedIso: new Date().toISOString(), quoteTimestampIso: q?.quoteAsOf || null };
  };
  const contract = (symbol, leg) => {
    const key = contractKey(symbol, leg);
    if (!cache.has(key)) cache.set(key, Promise.resolve().then(() => fetchContract(symbol, leg.expirySec, leg.type === "PUT" ? "put" : "call", leg.strike)));
    return cache.get(key);
  };
  return async function quote(t) {
    if (isStockTrade(t)) return stockQuote(t.symbol);
    const legs = t?.legs || [];
    if (!legs.length) return null;
    if (legs.some((l) => l.expirySec == null)) return null;
    const quotes = await Promise.all(legs.map(async (l) => {
      const c = await contract(t.symbol, l);
      const b = num(c?.b), a = num(c?.a);
      if (b == null || a == null || b < 0 || a <= 0 || b > a) return null;
      return { side: l.side, bid: b, ask: a, spot: num(c?.spot) };
    }));
    if (quotes.some((q) => !q)) return null;
    const spot = quotes[0].spot;
    const provenance = { source: quotes.length === 1 ? "Yahoo option quote" : "Yahoo synthetic net quote", observedIso: new Date().toISOString(), quoteTimestampIso: null };
    if (quotes.length === 1) return { bid: quotes[0].bid, ask: quotes[0].ask, spot, ...provenance };
    const long = quotes.find((q) => q.side === "BUY"), short = quotes.find((q) => q.side === "SELL");
    if (!long || !short) return null;
    // A negative net bid is not an executable zero-credit combo close.
    if (isCredit(t.structure)) return { bid: r2(short.bid - long.ask), ask: r2(short.ask - long.bid), spot, ...provenance };
    return { bid: r2(long.bid - short.ask), ask: r2(long.ask - short.bid), spot, ...provenance };
  };
}

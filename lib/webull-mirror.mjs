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

export const LEDGER_KEY = "webull-paper-ledger.json";
export const ACCOUNT_LABEL = "Webull paper";
const ENTRY_MAX_ATTEMPTS = 2;
const EXIT_MAX_ATTEMPTS = 12;
const MIN_RUN_GAP_MS = 60 * 1000;
const RUNS_KEPT = 60;
const GO_LIVE_LOOKBACK_MS = 3 * 60 * 60 * 1000;
const MAX_CANCEL_FAILS = 3;

// Webull's order statuses: SUBMITTED, CANCELLED, FAILED, FILLED, PARTIAL_FILLED
// ("PARTIAL FILLED" in the SDK's labels). Anything not known to be final
// counts as still working, so an unfamiliar status can never let a second
// order go out next to a live one. CANCEL_FAILED is the mirror's own marker.
const WAIT_NOTE = "Waiting: orders are paused until the broker holdings check passes.";
const FINAL = new Set(["FILLED", "CANCELLED", "FAILED", "REJECTED", "EXPIRED"]);

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

export function isCredit(structure) {
  return structure === "credit_vertical";
}

// Option ticks: $0.01 under $3, $0.05 at $3 and up (penny-pilot names quote
// tighter, but a nickel is always a valid price). Spreads trade in pennies.
export function roundTick(price, { spread = false, nickel = false } = {}) {
  const p = num(price);
  if (p == null || !(p > 0)) return null;
  const tick = nickel ? 0.05 : spread || p < 3 ? 0.01 : 0.05;
  return Math.max(tick, Math.round(p / tick) * tick);
}

function priceText(p) {
  return Number(p).toFixed(2);
}

// Deterministic client_order_id (Webull caps it at 32 chars, unique per
// account): a rerun of the same attempt reuses the same id, so a crash between
// placing and saving can't double-buy.
export function clientOrderId(tradeId, phase, attempt) {
  return "ms" + createHash("sha256").update(`${tradeId}|${phase}|${attempt}`).digest("hex").slice(0, 28);
}

// One Webull order body. phase "entry" opens, "exit" closes.
export function buildOrder(t, phase, limit, coid, quantity = 1) {
  if (!Number.isInteger(quantity) || quantity < 1) throw new Error("invalid order quantity");
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

function engineIndex(acc) {
  const map = new Map();
  for (const e of Array.isArray(acc?.open) ? acc.open : []) if (e?.symbol && e.entryDate) map.set(pickTradeId(e), { e, closed: false });
  for (const e of Array.isArray(acc?.closed) ? acc.closed : []) if (e?.symbol && e.entryDate) map.set(pickTradeId(e), { e, closed: true });
  return map;
}

export function newTrade(e, id) {
  const structure = e.contract?.structure || "long";
  return {
    tradeId: id,
    symbol: e.symbol,
    side: e.side === "put" ? "put" : "call",
    structure,
    legs: mirrorLegs(e),
    engineEntryPrice: r2(entryPrice(e)),
    engineEntryIso: e.entryDate,
    state: "entering",
    executionPolicy: EXECUTION_POLICY,
    requestedQty: 1, filledQty: 0, closedQty: 0, openQty: 0,
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
  t.labels = [t.entrySource === "manual" ? "Manual entry, broker-confirmed; automated exits only" : null, entryLabel(t),
    t.automaticEntryOutcome === "missed" ? "Earlier automatic entry missed; manually recovered" : null,
    exit.qty === entry.qty && entry.qty > 0 ? exitLabel(t) : null,
    t.entryEndOfDayUsed ? "End-of-day entry attempt (5% cap)" : null,
    t.emergencyExitUsed ? t.emergencyExitFilled ? t.openQty > 0 ? "Emergency end-of-day exit: broker-confirmed partial fill; exposure remains open" : "Emergency end-of-day exit: broker-confirmed fill" : "Emergency end-of-day exit attempted; fill not confirmed" : null].filter(Boolean);
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
  placeOrders = true, checkpoint = async () => {}, guard = () => {}, clock = Date.now, budgetMs = 40000, endOfDayOnly = false }) {
  const L = ledger && typeof ledger === "object" ? ledger : emptyLedger();
  L.trades ||= {}; L.runs = Array.isArray(L.runs) ? L.runs : [];
  const nowIso = new Date(nowMs).toISOString(), started = clock(), log = [];
  const eventMs = () => nowMs + Math.max(0, clock() - started);
  const eventIso = () => new Date(eventMs()).toISOString();
  const summary = { at: nowIso, placed: 0, filled: 0, cancelled: 0, missed: 0, closed: 0, errors: 0, skipped: null, note: null };
  const check = () => { guard(); if (clock() - started >= budgetMs) throw Object.assign(new Error("reconciliation budget reached"), { code: "RUN_BUDGET" }); };
  const save = async () => { guard(); await checkpoint(L); };
  if (!Array.isArray(acc?.open) || !Array.isArray(acc?.closed)) return { ledger: L, summary: { ...summary, skipped: "track record unavailable" }, log };
  if (L.accountId && L.accountId !== String(accountId)) throw Object.assign(new Error("ledger belongs to another account"), { code: "ACCOUNT_MISMATCH" });
  if (L.lastRunIso && nowMs - Date.parse(L.lastRunIso) < MIN_RUN_GAP_MS && (L.engineSnapshotIso ?? null) === (acc.builtAtIso ?? null)) return { ledger: L, summary: { ...summary, skipped: "ran less than a minute ago" }, log };
  const listed = await client.accountList();
  const accounts = Array.isArray(listed) ? listed : Array.isArray(listed?.accounts) ? listed.accounts : Array.isArray(listed?.data) ? listed.data : [];
  if (!accounts.some((a) => String(a?.account_id ?? a?.accountId ?? a?.id) === String(accountId))) throw Object.assign(new Error("configured Webull paper account is not in this key's account list"), { code: "ACCOUNT_NOT_FOUND" });
  L.accountId = String(accountId); L.version = 2;
  if (!L.goLiveIso) {
    const built = Date.parse(acc.builtAtIso), floor = nowMs - GO_LIVE_LOOKBACK_MS;
    L.goLiveIso = new Date(Number.isFinite(built) && built <= nowMs ? Math.max(built - 30 * 60000, floor) : nowMs).toISOString();
  }
  const engine = engineIndex(acc), session = isRegularSession(nowMs), cutoff = endOfDayWindow(nowMs), canTrade = placeOrders && session;
  let marketShut = false, snapshot = null, snapshotsHealthy = true, processingComplete = false;
  for (const [id, { e, closed }] of engine) {
    if (L.trades[id] || !e.contract || (Date.parse(e.entryDate) || 0) < Date.parse(L.goLiveIso)) continue;
    const t = newTrade(e, id);
    if (!t.legs || !(t.engineEntryPrice > 0)) { t.state = "skipped"; t.note = "contract details missing or unsupported"; }
    else if (closed) { t.state = "missed"; t.note = "opened and closed between mirror runs"; }
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
      // Failure to enrich a confirmed terminal order does not invalidate its
      // already-confirmed quantity or block a risk-reducing exit.
      if (terminalConfirmed) { a.metadataUnavailable = true; recordOrderObservation(a, "metadata-unavailable", eventIso()); await save(); return; }
      a.lookupFailed = true;
      // A missing response is not proof a previously submitted order never
      // filled. Only a journaled, unacknowledged intent may be replayed, using
      // its SAME client id and exact order body (never a new attempt).
      if (isOrderNotFoundError(err) && ["PREPARED", "UNKNOWN"].includes(a.status) && !a.filledQty) { a.notFound = true; a.lookupFailed = false; }
      else { summary.errors++; log.push(`${t.tradeId}: order status unavailable`); }
      recordOrderObservation(a, "lookup-unavailable", eventIso());
    }
    await save();
  }
  // Entries filled before broker legs were recorded have no proof to bind
  // their v3 position group, which paused the whole account. Re-read the
  // broker's own order detail for those legs; engine legs are never proof.
  async function proveLegs(t) {
    if (!(t.openQty > 0) || t.brokerPosition || t.needsReview || t.entryAttempts.some(a => a.filledQty > 0 && a.brokerLegs)) return;
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
        if (!t.openQty || !L.positionBaseline) continue;
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
      L.reconciliation = reconcilePositions(L, snapshot, eventIso());
    } catch (err) {
      if (["RUN_BUDGET", "LEASE_EXPIRED"].includes(err.code)) throw err;
      snapshotsHealthy = false;
      L.reconciliation = { checkedAtIso: nowIso, status: "unavailable", alerts: [stage === "positions-api" ? "Broker positions request failed; orders paused." : "Broker position schema or group direction is unverified; orders paused."],
        failure: { stage, code: err.code || (stage === "positions-parse" ? "POSITION_SCHEMA" : "POSITIONS_REQUEST_FAILED"), status: err.status ?? null,
          // Parse errors are fixed strings (no broker data); API errors may echo the broker, so they stay out.
          ...(stage === "positions-parse" ? { reason: String(err.message || "").slice(0, 120) } : {}) }, blockedTradeIds: trades.map((t) => t.tradeId) };
      summary.errors++;
    }
    await save();
  }
  const aligned = (t) => snapshotsHealthy && !L.reconciliation?.blockedTradeIds?.includes(t.tradeId) &&
    ![...t.entryAttempts, ...t.exitAttempts].some(a => a.lookupFailed);
  async function cancel(t, phase) {
    const a = lastAttempt(t, phase);
    if (!a || FINAL.has(a.status)) return true;
    if (a.lookupFailed || a.notFound || ["PREPARED", "UNKNOWN"].includes(a.status)) return false;
    check(); a.cancelRequestedIso ||= nowIso; a.lastCancelRequestedIso = nowIso;
    recordOrderObservation(a, "cancel-request", eventIso()); await save(); check();
    try { await client.cancelOrder(accountId, a.clientOrderId); }
    catch { /* A fill can win the cancel race. Only the subsequent detail decides. */ }
    await refresh(t, phase);
    if (a.lookupFailed || !FINAL.has(a.status)) {
      a.status = "CANCEL_FAILED"; a.cancelFails = (a.cancelFails || 0) + 1;
      if (a.cancelFails >= MAX_CANCEL_FAILS && (!t.needsReview || t.reviewCode === "CANCEL_UNCONFIRMED")) attention(t, `couldn't confirm the ${phase} order was cancelled; check Webull by hand`, "CANCEL_UNCONFIRMED");
      summary.errors++; await save(); return false;
    }
    if (a.status === "CANCELLED") summary.cancelled++;
    await positions(); // captures fills that happened while cancelling
    return true;
  }
  async function submit(t, a) {
    if (a.phase === "entry" && t.entrySource === "manual") throw Object.assign(new Error("a manual entry cannot be replayed by the mirror"), { code: "MANUAL_ENTRY_REPLAY" });
    check(); recordOrderObservation(a, "submission-request", eventIso()); await save(); check(); // durable intent BEFORE the broker mutation
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
        if (a.status === "UNKNOWN" || a.lookupFailed) summary.errors++;
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
      else await submit(t, a);
    }
    return true;
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
    if (phase === "entry" && t.note === WAIT_NOTE) t.note = null;
    const quantity = phase === "entry" ? t.requestedQty - t.filledQty : t.openQty;
    if (!Number.isInteger(quantity) || quantity < 1) return;
    const list = phase === "entry" ? t.entryAttempts : t.exitAttempts;
    const px = plan ? limit : roundTick(limit, { spread: t.legs.length > 1, nickel: list.some((a) => a.status === "REJECTED" && !a.marketClosed) });
    if (!(px > 0)) return;
    check(); const q = quote !== undefined ? quote : await quoteFn(t).catch(() => null); check();
    const n = list.length + 1, coid = clientOrderId(t.tradeId, phase, n);
    const a = { phase, n, quantity, filledQty: 0, clientOrderId: coid, limit: px, why, sentIso: eventIso(), status: "PREPARED", filledPrice: null, filledIso: null,
      bid: num(q?.bid), ask: num(q?.ask), spot: num(q?.spot), quoteSource: q?.source || "unknown", quoteObservedIso: q?.observedIso || nowIso,
      quoteTimestampIso: q?.quoteTimestampIso || null, executionPolicy: EXECUTION_POLICY,
      policyStage: plan?.stage || null, allowancePct: plan?.allowancePct ?? null, referencePrice: plan?.reference ?? null,
      emergency: !!plan?.emergency, order: buildOrder(t, phase, px, coid, quantity) };
    recordOrderObservation(a, "prepared", eventIso());
    list.push(a); updateQuantities(t); await save();
    if (client.previewOrder) { check(); try { a.feeEst = parsePreviewFee(await client.previewOrder(accountId, [a.order])); } catch { /* unknown fees stay unknown */ } }
    await submit(t, a);
  }
  function finishEntry(t, reason) {
    if (t.filledQty > 0) { t.state = "open"; t.note = reason || null; summary.filled++; }
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
    await positions();
    const ordered = trades.slice().sort((a, b) => Number(!!b.openQty) - Number(!!a.openQty) || String(a.lastProcessedIso || "").localeCompare(String(b.lastProcessedIso || "")));
    for (const t of ordered) {
      check();
      if (!t.legs?.length || ["skipped", "settled"].includes(t.state)) continue;
      if (t.state === "missed") {
        const eng = engine.get(t.tradeId);
        if (cutoff.due && entrySessionMatches(t, nowMs) && eng && !eng.closed && !t.filledQty && !t.needsReview && t.entrySource !== "manual" && !t.entryAttempts.some(a => a.policyStage === "eod-entry")) t.state = "entering";
        else continue;
      }
      if (!Number.isInteger(t.requestedQty) || t.requestedQty < 1 || t.filledQty > t.requestedQty || t.closedQty + (t.settledQty || 0) > t.filledQty) { attention(t, "Invalid position quantity; check Webull."); continue; }
      const eng = engine.get(t.tradeId), expiry = expiryControl(t, nowMs);
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
        t.engineExitPrice = r2(markPrice(eng.e)); t.enginePnlPct = r1(num(eng.e.optionPnlPct));
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
    summary.note = "Time budget reached; remaining reconciliation continues next run.";
    L.reconciliation = { ...L.reconciliation, status: "incomplete", alerts: [...(L.reconciliation?.alerts || []), "Reconciliation incomplete; a build follow-up or manual reconciliation is needed."] };
  }
  if (endOfDayOnly && cutoff.known && cutoff.open && !session && cutoff.minute >= cutoff.closeMinute) for (const t of trades) {
    if (t.needsReview && !["EOD_ORDER_UNCONFIRMED", "EOD_EXIT_UNFILLED"].includes(t.reviewCode)) continue;
    if (t.openQty > 0 && (t.engineExitIso || t.mirrorCloseReason)) attention(t, "Session ended with a signaled exit still unfilled; broker exposure remains open.", "EOD_EXIT_UNFILLED");
    if ([...t.entryAttempts, ...t.exitAttempts].some(a => !FINAL.has(a.status))) attention(t, "Session ended with an order outcome unconfirmed; inspect Webull.", "EOD_ORDER_UNCONFIRMED");
  }
  const review = trades.filter((t) => t.needsReview).map((t) => `${t.symbol}: ${t.note}`);
  for (const t of trades) if ([...t.entryAttempts, ...t.exitAttempts].some((a) => a.lookupFailed || ["UNKNOWN", "PREPARED"].includes(a.status))) review.push(`${t.symbol}: order acknowledgment/status unverified; entries paused.`);
  if (review.length) L.reconciliation = { ...L.reconciliation, status: "attention", alerts: [...new Set([...(L.reconciliation?.alerts || []), ...review])] };
  summary.alerts = L.reconciliation?.alerts?.length || 0;
  summary.followUpNeeded = !!(canTrade && (!summary.alerts || L.reconciliation?.status === "incomplete" && summary.alerts === 1) && trades.some((t) =>
    [...t.entryAttempts, ...t.exitAttempts].some((a) => !FINAL.has(a.status)) ||
    (t.state === "entering" && t.filledQty < t.requestedQty) || (t.state === "exiting" && t.openQty > 0)));
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
    const row = {
      trade_id: t.tradeId,
      source: "webull-paper",
      account: t.entrySource === "manual" ? `${ACCOUNT_LABEL} (manual entry)` : ACCOUNT_LABEL,
      symbol: t.symbol,
      side: t.side,
      structure: t.structure,
      legs: (t.legs || []).map((l) => `${l.side} ${l.expiry} ${l.strike} ${l.type}`).join(" / "),
      qty: filledQty || t.requestedQty || 1,
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
    out.push({
      tradeId: t.tradeId, symbol: t.symbol, side: t.side, structure: t.structure, state: t.state,
      entrySource: t.entrySource || "automatic",
      automaticEntryOutcome: t.automaticEntryOutcome || null, automaticEntryAttemptCount: t.automaticEntryAttemptCount ?? entryA.length,
      executionPolicy: t.executionPolicy || "legacy", entryEndOfDayUsed: !!t.entryEndOfDayUsed,
      emergencyExitUsed: !!t.emergencyExitUsed, emergencyExitFilled: !!t.emergencyExitFilled,
      requestedQty: t.requestedQty ?? 1, filledQty: t.filledQty ?? (t.fillPrice != null ? 1 : 0),
      closedQty: t.closedQty ?? (t.closeFillPrice != null ? 1 : 0), openQty: t.openQty ?? null,
      needsReview: !!t.needsReview, expiryControl: t.expiryControl ?? null, mirrorCloseReason: t.mirrorCloseReason ?? null,
      legs: (t.legs || []).map((l) => `${l.side} ${l.expiry} ${l.strike} ${l.type}`).join(" / "),
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
      labels: t.labels || [], note: t.note || null,
      decisions: (t.executionDecisions || []).map(d => ({ phase: d.phase, stage: d.stage, observedIso: d.observedIso, reason: d.reason, bid: d.bid, ask: d.ask, quoteSource: d.quoteSource })),
      attempts: [...(t.entryAttempts || []), ...(t.exitAttempts || [])].map(a => ({ phase: a.phase, n: a.n,
        source: a.source || "automatic", stage: a.policyStage || "legacy", sentIso: a.sentIso, status: a.status,
        quantity: a.quantity, filledQty: a.filledQty, limit: a.limit, filledPrice: a.filledPrice ?? null, filledIso: a.filledIso ?? null,
        bid: a.bid ?? null, ask: a.ask ?? null, allowancePct: a.allowancePct ?? null, referencePrice: a.referencePrice ?? null,
        cancelRequestedIso: a.cancelRequestedIso ?? null, lastCancelRequestedIso: a.lastCancelRequestedIso ?? null, quoteSource: a.quoteSource || "unknown",
        quoteObservedIso: a.quoteObservedIso ?? null, quoteTimestampIso: a.quoteTimestampIso ?? null, emergency: !!a.emergency,
        brokerOrderId: a.brokerOrderId ?? a.order?.order_id ?? null, feeActual: a.feeActual ?? null, feeEstimate: a.feeEst ?? null,
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
  const cols = [...FILL_COLUMNS, "your_pnl_pct", "entry_slippage_pct", "entry_source", "entry_price_difference_pct", "entry_end_of_day", "emergency_exit_used", "emergency_exit_filled", "exit_slippage_pct", "exit_price_difference_pct", "automatic_entry_outcome", "automatic_entry_attempt_count", "execution_decisions_json"];
  return [cols.join(","), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))].join("\n") + "\n";
}

export function orderAttemptsToCsv(ledger) {
  const cols = ["trade_id", "symbol", "phase", "attempt", "source", "policy_stage", "broker_status", "requested_qty", "cumulative_filled_qty",
    "modeled_price", "limit_price", "average_fill_price", "fill_price_difference_pct", "adverse_slippage_pct", "broker_order_id",
    "sent_time_iso", "fill_time_iso", "emergency", "end_of_day_entry", "actual_fees", "estimated_fees", "bid", "ask", "quote_source",
    "quote_fetched_iso", "first_cancel_requested_iso", "last_cancel_requested_iso", "observations_json"];
  const rows = ledgerToTestTrades(ledger).flatMap(t => t.attempts.map(a => {
    const reference = a.referencePrice ?? (a.phase === "entry" ? t.engineEntryPrice : t.engineExitPrice);
    const gap = diffPct(a.filledPrice, reference), credit = isCredit(t.structure);
    const buying = a.phase === "entry" ? !credit : credit;
    return [t.tradeId, t.symbol, a.phase, a.n, a.source, a.stage, a.status, a.quantity, a.filledQty,
      reference, a.limit, a.filledPrice, gap, gap == null ? null : buying ? gap : -gap, a.brokerOrderId,
      a.sentIso, a.filledIso, a.emergency, a.stage === "eod-entry", a.feeActual, a.feeEstimate, a.bid, a.ask, a.quoteSource,
      a.quoteObservedIso, a.cancelRequestedIso, a.lastCancelRequestedIso, JSON.stringify(a.observations)];
  }));
  return [cols.join(","), ...rows.map(row => row.map(csvCell).join(","))].join("\n") + "\n";
}

// --- Live quotes ----------------------------------------------------------------

// quoteFn for runWebullMirror from lib/yahoo.mjs fetchContract: one Yahoo call
// per distinct leg per run, cached across retries. Returns the position's bid/ask per share in its opening direction:
// a long's own quote, a debit spread's net debit, a credit spread's net credit.
export function makeQuoteFn(fetchContract) {
  const cache = new Map();
  const contract = (symbol, leg) => {
    const key = contractKey(symbol, leg);
    if (!cache.has(key)) cache.set(key, Promise.resolve().then(() => fetchContract(symbol, leg.expirySec, leg.type === "PUT" ? "put" : "call", leg.strike)));
    return cache.get(key);
  };
  return async function quote(t) {
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

// Real Webull fees for the paper mirror (2026-11-19, wave 2 build A).
//
// Each order's preview gives a fee ESTIMATE before it is sent (feeEst on the
// attempt). The real commission and fees sit on each order in Webull's order
// history (GET /trading/orders/historical-orders/list, official OpenAPI,
// developer.webull.com/apis/docs/reference/order-history; the 2026-11-19
// paper-key probe found `commission` and `fees` on every order there and no
// fee rows at all in cash activity). Their inner fields are the ones the
// order-detail page documents (developer.webull.com/apis/docs/reference/
// order-detail): commission.actual_commission, fees[].type, fees[].actual_value,
// read by parseOrderDetail in lib/webull-mirror.mjs, so both paths agree.
//
// After each mirror run, one history read (two pages at most, the default
// last 7 days) fills feeActual on every filled attempt that still lacks it,
// marked feeSource "order-history". The preview estimate stays on the attempt
// as the fallback and for the real-vs-estimate comparison. Orders older than
// 7 days that never got a real fee keep their estimate.

import { parseOrderDetail, updateQuantities } from "./webull-mirror.mjs";

export const HISTORY_DAYS = 7;
export const MAX_HISTORY_PAGES = 2;
const DAY_MS = 86400000;
const num = (v) => { const n = Number(v); return v == null || v === "" || !Number.isFinite(n) ? null : n; };
const r2 = (x) => Math.round(x * 100) / 100;

// Order-history reply -> { orders: [{ clientOrderId, orderId, feeActual, feeLines }], next }.
export function parseOrderHistory(resp) {
  const groups = Array.isArray(resp) ? resp : Array.isArray(resp?.data) ? resp.data : [];
  const orders = [];
  for (const g of groups) {
    const list = Array.isArray(g?.orders) ? g.orders : g && typeof g === "object" && g.client_order_id && !g.orders ? [g] : [];
    for (const o of list) {
      const d = parseOrderDetail(o);
      const coid = o?.client_order_id ?? g?.client_order_id ?? null;
      if (!coid || !d) continue;
      const feeLines = Array.isArray(o.fees) ? o.fees.map((f) => ({ type: String(f?.type || "fee"), value: num(f?.actual_value) })).filter((f) => f.value != null) : [];
      const commission = num(o.commission?.actual_commission);
      if (commission != null && commission > 0) feeLines.unshift({ type: "COMMISSION", value: commission });
      orders.push({ clientOrderId: String(coid), orderId: d.brokerOrderId, status: d.status, filledQty: d.filledQty, feeActual: d.feeActual, feeLines });
    }
  }
  const next = !Array.isArray(resp) && resp?.pagination_key ? String(resp.pagination_key) : null;
  return { orders, next };
}

// The key names of the first history order (no values), saved on the ledger
// so the first live run shows whether the reply has the fields we read.
export function historyShape(resp) {
  const groups = Array.isArray(resp) ? resp : Array.isArray(resp?.data) ? resp.data : [];
  const o = groups.find((g) => Array.isArray(g?.orders) && g.orders.length)?.orders?.[0];
  if (!o) return null;
  return { order: Object.keys(o).sort(), commission: o.commission && typeof o.commission === "object" ? Object.keys(o.commission).sort() : null,
    fee: Array.isArray(o.fees) && o.fees[0] && typeof o.fees[0] === "object" ? Object.keys(o.fees[0]).sort() : null };
}

const filled = (t) => [...(t.entryAttempts || []), ...(t.exitAttempts || [])].filter((a) => (num(a.filledQty) ?? 0) > 0);
// Only an attempt with an order ID can be matched to an order-history row.
const filledAttempts = (t) => filled(t).filter((a) => a.clientOrderId);

// Filled attempts still without a real fee, sent inside the history window.
export function attemptsNeedingFees(ledger, nowMs = Date.now()) {
  const out = [];
  for (const t of Object.values(ledger?.trades || {})) for (const a of filledAttempts(t)) {
    const sent = Date.parse(a.sentIso || a.filledIso);
    if (num(a.feeActual) == null && Number.isFinite(sent) && nowMs - sent <= HISTORY_DAYS * DAY_MS) out.push({ t, a });
  }
  return out;
}

// Apply history rows to the ledger. Returns how many attempts got a fee.
export function applyHistoryFees(ledger, orders, observedIso = new Date().toISOString()) {
  const byCoid = new Map(orders.map((o) => [o.clientOrderId, o]));
  let applied = 0;
  const touched = new Set();
  for (const t of Object.values(ledger?.trades || {})) for (const a of filledAttempts(t)) {
    if (num(a.feeActual) != null) continue;
    const o = byCoid.get(String(a.clientOrderId));
    if (!o || o.feeActual == null) continue;
    // The history row must describe the same fill we hold (no partial-fee mix-ups).
    if (o.filledQty != null && o.filledQty !== a.filledQty) continue;
    a.feeActual = r2(o.feeActual); a.feeSource = "order-history"; a.feeLines = o.feeLines; a.feeObservedIso = observedIso;
    applied++; touched.add(t);
  }
  for (const t of touched) updateQuantities(t);
  return applied;
}

// One history sweep after a mirror run. Calls nothing when no filled attempt
// is missing a fee. Errors are counted, never thrown (fees never block a run),
// except the lease / time-budget stops, which pass through.
export async function backfillFees({ client, accountId, ledger, nowMs = Date.now(), maxPages = MAX_HISTORY_PAGES, check = () => {} }) {
  const out = { needed: 0, calls: 0, applied: 0, error: null };
  const need = attemptsNeedingFees(ledger, nowMs);
  out.needed = need.length;
  if (!need.length || typeof client?.orderHistory !== "function") return out;
  // Webull's format is yyyy-MM-dd'T'HH:mm:ss.SSS'Z' (toISOString).
  const earliest = Math.min(...need.map(({ a }) => Date.parse(a.sentIso || a.filledIso))) - DAY_MS;
  const startTime = new Date(Math.max(earliest, nowMs - HISTORY_DAYS * DAY_MS)).toISOString();
  const orders = [];
  let key = null;
  try {
    for (let page = 0; page < maxPages; page++) {
      check();
      out.calls++;
      const resp = await client.orderHistory(accountId, { start_time: startTime, end_time: new Date(nowMs).toISOString(), pagination_key: key });
      if (page === 0 && ledger) ledger.orderHistoryShape = historyShape(resp) || ledger.orderHistoryShape || null;
      const p = parseOrderHistory(resp);
      orders.push(...p.orders);
      key = p.next;
      if (!key) break;
    }
  } catch (err) {
    if (["RUN_BUDGET", "LEASE_EXPIRED"].includes(err?.code)) throw err;
    out.error = err?.status ? `HTTP ${err.status}` : "order history unavailable";
  }
  out.applied = applyHistoryFees(ledger, orders, new Date(nowMs).toISOString());
  return out;
}

// Real vs estimated fees of one trade, for the Real fills tab and the CSVs.
// actual: the sum of real fees when every filled attempt has one, else null.
// estimated: the preview estimates pro-rated to fills (as updateQuantities
// does), when every filled attempt had a preview. basis: which one t.fees uses.
export function feeBreakdown(t) {
  const list = filled(t);
  if (!list.length) return { actual: null, estimated: null, basis: null, realOrders: 0, orders: 0 };
  let actual = 0, est = 0, actualKnown = true, estKnown = true, real = 0;
  for (const a of list) {
    if (num(a.feeActual) != null) { actual += Number(a.feeActual); real++; } else actualKnown = false;
    if (num(a.feeEst) != null) est += Number(a.feeEst) * Number(a.filledQty) / (num(a.quantity) || 1); else estKnown = false;
  }
  return { actual: actualKnown ? r2(actual) : null, estimated: estKnown ? r2(est) : null,
    basis: real === list.length ? "actual" : real ? "mixed" : estKnown ? "estimate" : null, realOrders: real, orders: list.length };
}

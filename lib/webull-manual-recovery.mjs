// Pure, reviewable recovery plan. Does not write the store or call the broker.
import { newTrade, parseOrderDetail, updateQuantities } from "./webull-mirror.mjs";
import { pickTradeId } from "./pick-trade-text.mjs";
import { bindPositionGroup, brokerLegKey, confirmedOrderLegs } from "./webull-position-groups.mjs";
import { parsePositions, reconcilePositions } from "./webull-reconciliation.mjs";

function orderFrom(response) {
  const order = response?.orders?.length === 1 ? response.orders[0] : null;
  const detail = parseOrderDetail(response);
  if (!order?.client_order_id || detail?.status !== "FILLED" || !Number.isInteger(detail.filledQty) || detail.filledQty < 1 ||
      detail.filledQty !== Number(order.total_quantity) || !(detail.filledPrice > 0) ||
      !Number.isFinite(Date.parse(detail.filledIso)) || !Number.isFinite(Date.parse(order.place_time_at)) ||
      Date.parse(detail.filledIso) < Date.parse(order.place_time_at) || !confirmedOrderLegs(order)) throw new Error("recovery requires a complete confirmed broker fill, timestamp and exact standard legs");
  return { order, detail };
}

function bindFilledOrder(positions, order, detail) {
  const proof = detail.brokerLegs;
  const matches = positions.filter(r => r.legs?.length === proof.length && Number(r.quantity) === detail.filledQty &&
    r.legs.every(l => proof.some(p => brokerLegKey(p) === brokerLegKey(l))));
  if (matches.length !== 1) throw new Error("recovery requires one uniquely matching broker position group");
  return bindPositionGroup(matches[0], proof, order.client_order_id);
}

function verifyTradeLegs(t, detail) {
  if (detail.brokerLegs.length !== t.legs.length || detail.brokerLegs.some(l => !t.legs.some(p =>
    t.symbol === l.symbol && p.expiry === l.option_expire_date && p.type === l.option_type &&
    p.strike === Number(l.strike_price) && p.side === l.side))) throw new Error("broker fill does not match the published pick's exact legs and direction");
}

export function prepareManualRecovery({ ledger, acc, positions, manualOrder, heldOrders = [], externalOrders = [], accountId, checkedAtIso }) {
  if (ledger.accountId !== accountId || !Number.isFinite(Date.parse(checkedAtIso))) throw new Error("recovery account or inspection time is invalid");
  if (!Array.isArray(positions) || !Array.isArray(acc?.open)) throw new Error("complete positions and published picks are required");
  const next = structuredClone(ledger), { order, detail } = orderFrom(manualOrder);
  const matches = acc.open.filter(e => {
    try { verifyTradeLegs(newTrade(e, pickTradeId(e)), detail); return true; } catch { return false; }
  });
  if (matches.length !== 1) throw new Error("manual order must match exactly one published open pick");
  const e = matches[0], id = pickTradeId(e), existing = next.trades[id];
  if (!Number.isFinite(Date.parse(ledger.goLiveIso)) || Date.parse(e.entryDate) < Date.parse(ledger.goLiveIso)) throw new Error("manual pick predates the mirror's activation");
  if (Date.parse(detail.filledIso) < Date.parse(e.entryDate) || Date.parse(detail.filledIso) > Date.parse(checkedAtIso)) throw new Error("manual fill is outside the verified recovery window");
  if (existing && !(existing.entrySource === "manual" && existing.entryAttempts?.length === 1 && existing.entryAttempts[0].clientOrderId === order.client_order_id)) throw new Error("trade already has execution state; refusing to replace its intents");
  if (!existing) {
    const t = newTrade(e, id);
    Object.assign(t, { entrySource: "manual", state: "open", requestedQty: detail.filledQty,
      provenance: { source: "manual-broker-order", importedAtIso: checkedAtIso, brokerOrderId: order.order_id, brokerClientOrderId: order.client_order_id },
      entryAttempts: [{ phase: "entry", n: 1, quantity: detail.filledQty, filledQty: detail.filledQty,
        clientOrderId: order.client_order_id, status: "FILLED", limit: Number(order.limit_price),
        sentIso: order.place_time_at, filledIso: detail.filledIso, filledPrice: detail.filledPrice,
        feeActual: detail.feeActual, brokerLegs: detail.brokerLegs,
        source: "manual", order: structuredClone(order) }],
      brokerPosition: bindFilledOrder(positions, order, detail) });
    updateQuantities(t); next.trades[id] = t;
  }
  for (const t of Object.values(next.trades).filter(t => t.openQty > 0 && t.tradeId !== id)) {
    const response = heldOrders.find(r => t.entryAttempts?.some(a => a.clientOrderId === r.client_order_id));
    const verified = orderFrom(response); verifyTradeLegs(t, verified.detail);
    if (t.entryAttempts.length !== 1 || t.exitAttempts.length || verified.detail.filledQty !== t.openQty) throw new Error("legacy recovery requires explicit review of partial or multi-attempt holdings");
    const a = t.entryAttempts[0];
    Object.assign(a, { brokerLegs: verified.detail.brokerLegs, feeActual: verified.detail.feeActual });
    t.brokerPosition = bindFilledOrder(positions, verified.order, verified.detail); updateQuantities(t);
  }
  const external = externalOrders.map(response => {
    const verified = orderFrom(response);
    return { ...verified, binding: bindFilledOrder(positions, verified.order, verified.detail) };
  });
  const managed = Object.values(next.trades).filter(t => t.openQty > 0).map(t => t.brokerPosition);
  const bindings = [...managed, ...external.map(x => x.binding)];
  if (new Set(bindings.map(x => x.positionId)).size !== bindings.length) throw new Error("recovery cannot allocate a broker group twice");
  const snapshot = parsePositions(positions, bindings);
  const options = {}, groups = {};
  for (const x of external) {
    const group = snapshot.groups[x.binding.positionId]; groups[x.binding.positionId] = group;
    for (const [key, quantity] of Object.entries(group.options)) options[key] = (options[key] || 0) + quantity;
  }
  if (next.positionBaseline && JSON.stringify(next.positionBaseline.options) !== JSON.stringify(options)) throw new Error("existing holdings baseline differs; explicit review is required");
  next.positionBaseline = { capturedAtIso: checkedAtIso, options, equities: snapshot.equities, groups,
    externalOrders: external.map(x => ({ clientOrderId: x.order.client_order_id, orderId: x.order.order_id,
      source: "manual-unmanaged", filledQty: x.detail.filledQty, filledPrice: x.detail.filledPrice,
      filledIso: x.detail.filledIso, feeActual: x.detail.feeActual, brokerLegs: x.detail.brokerLegs })) };
  const reconciliation = reconcilePositions(next, snapshot, checkedAtIso);
  if (reconciliation.status !== "matched") throw new Error("recovery plan does not reconcile with broker holdings");
  // Keep lastRunIso/engineSnapshotIso unchanged: preparing a plan is not a run.
  next.recovery = { preparedAtIso: checkedAtIso, source: "confirmed-broker-orders", manualTradeId: id, manage: "spread-exits-only" };
  return { ledger: next, reconciliation, manualTradeId: id };
}

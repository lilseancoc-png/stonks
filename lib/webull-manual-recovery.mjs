// Pure, reviewable recovery plan. Does not write the store or call the broker.
import { newTrade, parseOrderDetail, updateQuantities, recordOrderObservation, resolveOrderReview } from "./webull-mirror.mjs";
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

export function prepareManualRecovery({ ledger, acc, positions, manualOrder, manualOrders = null, heldOrders = [], retiredOrders = [], externalOrders = [], accountId, checkedAtIso }) {
  if (ledger.accountId !== accountId || !Number.isFinite(Date.parse(checkedAtIso))) throw new Error("recovery account or inspection time is invalid");
  if (!Array.isArray(positions) || !Array.isArray(acc?.open)) throw new Error("complete positions and published picks are required");
  const next = structuredClone(ledger), adopted = [];
  // The last execution window can have ended before a fill was observed.
  // Refresh known entry evidence in the proposal before allocating groups.
  for (const t of Object.values(next.trades || {})) {
    let refreshed = false;
    for (const a of t.entryAttempts || []) {
      const proof = [...heldOrders, ...retiredOrders].find(r => r?.orders?.length === 1 && r.orders[0].client_order_id === a.clientOrderId);
      if (!proof) continue;
      refreshed = true;
      if (!a.observations?.length) recordOrderObservation(a, "saved-state", checkedAtIso);
      const d = parseOrderDetail(proof);
      if (!d || !Number.isInteger(d.filledQty) || d.filledQty < (a.filledQty || 0) || d.filledQty > a.quantity) throw new Error("saved entry and broker quantities disagree");
      if (d.filledQty > 0) {
        const verified = orderFrom(proof); verifyTradeLegs(t, verified.detail);
        Object.assign(a, { filledQty: d.filledQty, filledPrice: d.filledPrice, filledIso: d.filledIso,
          feeActual: d.feeActual ?? (d.filledQty === a.filledQty ? a.feeActual : null) ?? null, brokerLegs: d.brokerLegs });
      }
      a.status = d.status; a.lookupFailed = false; a.notFound = false;
      if (d.brokerOrderId) a.brokerOrderId = d.brokerOrderId;
      recordOrderObservation(a, "broker-detail", checkedAtIso);
    }
    if (refreshed) updateQuantities(t);
    if (refreshed) resolveOrderReview(t);
    if (refreshed && t.openQty > 0 && ["entering", "missed"].includes(t.state)) t.state = "open";
  }
  const supplied = manualOrders || [manualOrder];
  if (!supplied.length) throw new Error("at least one confirmed manual order is required");
  for (const response of supplied) {
    const { order, detail } = orderFrom(response);
    const matches = [...acc.open, ...(acc.closed || [])].filter(e => {
      const entered = Date.parse(e.entryDate), filled = Date.parse(detail.filledIso), exited = e.exitDate ? Date.parse(e.exitDate) : null;
      if (!Number.isFinite(entered) || entered < Date.parse(ledger.goLiveIso) || filled < entered || exited != null && (!Number.isFinite(exited) || filled > exited)) return false;
      try { verifyTradeLegs(newTrade(e, pickTradeId(e)), detail); return true; } catch { return false; }
    });
    if (matches.length !== 1) throw new Error("manual order must match exactly one published pick");
    const e = matches[0], id = pickTradeId(e), existing = next.trades[id];
    if (!Number.isFinite(Date.parse(ledger.goLiveIso)) || Date.parse(e.entryDate) < Date.parse(ledger.goLiveIso)) throw new Error("manual pick predates the mirror's activation");
    if (Date.parse(detail.filledIso) < Date.parse(e.entryDate) || Date.parse(detail.filledIso) > Date.parse(checkedAtIso)) throw new Error("manual fill is outside the verified recovery window");
    if (e.exitDate && Date.parse(detail.filledIso) > Date.parse(e.exitDate)) throw new Error("manual entry filled after the site's close signal");
    const untouchedQueue = existing?.state === "entering" && !existing.needsReview && !existing.brokerPosition && !existing.provenance &&
      Array.isArray(existing.entryAttempts) && existing.entryAttempts.length === 0 &&
      Array.isArray(existing.exitAttempts) && existing.exitAttempts.length === 0 &&
      existing.filledQty === 0 && existing.closedQty === 0 && existing.openQty === 0 && (existing.settledQty == null || existing.settledQty === 0);
    const sameManualOrder = existing?.entrySource === "manual" && existing.entryAttempts?.some(a => a.source === "manual" && a.clientOrderId === order.client_order_id);
    const retiredQueue = existing && ["entering", "missed"].includes(existing.state) && !existing.needsReview && !existing.provenance && !existing.brokerPosition &&
      existing.filledQty === 0 && existing.closedQty === 0 && existing.openQty === 0 && !existing.settledQty && !existing.exitAttempts?.length &&
      existing.entryAttempts?.length > 0 && existing.entryAttempts.every(a => {
        const proof = retiredOrders.find(r => r?.orders?.length === 1 && r.orders[0].client_order_id === a.clientOrderId);
        const d = parseOrderDetail(proof);
        return d && ["CANCELLED", "REJECTED", "FAILED", "EXPIRED"].includes(d.status) && d.filledQty === 0 && !a.filledQty;
      });
    if (existing && !sameManualOrder && !untouchedQueue && !retiredQueue) throw new Error("trade already has execution state; refusing to replace its intents without terminal zero-fill broker evidence");
    if (adopted.includes(id)) throw new Error("duplicate manual allocation for the same pick");
    adopted.push(id);
    if (!existing || untouchedQueue || retiredQueue) {
      const t = newTrade(e, id);
      const prior = retiredQueue ? structuredClone(existing.entryAttempts).map(a => ({ ...a,
        status: parseOrderDetail(retiredOrders.find(r => r.orders[0].client_order_id === a.clientOrderId)).status,
        lookupFailed: false, notFound: false })) : [];
      Object.assign(t, { entrySource: "manual", state: "open", requestedQty: detail.filledQty,
        executionDecisions: structuredClone(existing?.executionDecisions || []),
        automaticEntryOutcome: prior.length ? "missed" : null, automaticEntryAttemptCount: prior.length,
        provenance: { source: "manual-broker-order", importedAtIso: checkedAtIso, brokerOrderId: order.order_id, brokerClientOrderId: order.client_order_id },
        entryAttempts: [...prior, { phase: "entry", n: prior.length + 1, quantity: detail.filledQty, filledQty: detail.filledQty,
          clientOrderId: order.client_order_id, status: "FILLED", limit: order.limit_price != null && Number.isFinite(Number(order.limit_price)) ? Number(order.limit_price) : null,
          sentIso: order.place_time_at, filledIso: detail.filledIso, filledPrice: detail.filledPrice,
          feeActual: detail.feeActual, brokerLegs: detail.brokerLegs,
          source: "manual", order: structuredClone(order) }],
        brokerPosition: bindFilledOrder(positions, order, detail) });
      recordOrderObservation(t.entryAttempts.at(-1), "manual-broker-import", checkedAtIso);
      updateQuantities(t); next.trades[id] = t;
    }
  }
  for (const t of Object.values(next.trades).filter(t => t.openQty > 0 && !adopted.includes(t.tradeId))) {
    if (t.exitAttempts.length) throw new Error("legacy recovery requires explicit review of partial closing holdings");
    let total = 0, last = null;
    for (const a of t.entryAttempts) {
      const response = heldOrders.find(r => r?.orders?.length === 1 && a.clientOrderId === r.orders[0]?.client_order_id);
      const d = parseOrderDetail(response);
      if (d && ["CANCELLED", "REJECTED", "FAILED", "EXPIRED"].includes(d.status) && d.filledQty === 0 && !a.filledQty) { a.status = d.status; continue; }
      const verified = orderFrom(response); verifyTradeLegs(t, verified.detail);
      if (a.filledQty !== verified.detail.filledQty) throw new Error("held fill quantities changed; reconcile before manual adoption");
      a.brokerLegs = verified.detail.brokerLegs;
      if (verified.detail.feeActual != null) a.feeActual = verified.detail.feeActual;
      total += verified.detail.filledQty; last = verified;
    }
    if (!last || total !== t.openQty) throw new Error("held quantities do not match confirmed broker fills");
    t.brokerPosition = bindFilledOrder(positions, last.order, { ...last.detail, filledQty: total }); updateQuantities(t);
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
  if (next.positionBaseline) {
    const equities = next.positionBaseline.equities;
    if (!equities || typeof equities !== "object" || Array.isArray(equities)) throw new Error("existing stock holdings baseline is unavailable; explicit review is required");
    const symbols = new Set([...Object.keys(equities), ...Object.keys(snapshot.equities)]);
    if ([...symbols].some(symbol => (Object.hasOwn(equities, symbol) ? equities[symbol] : 0) !== (snapshot.equities[symbol] ?? 0))) throw new Error("existing stock holdings baseline differs; explicit review is required");
  }
  next.positionBaseline = { capturedAtIso: checkedAtIso, options, equities: snapshot.equities, groups,
    externalOrders: external.map(x => ({ clientOrderId: x.order.client_order_id, orderId: x.order.order_id,
      source: "manual-unmanaged", filledQty: x.detail.filledQty, filledPrice: x.detail.filledPrice,
      filledIso: x.detail.filledIso, feeActual: x.detail.feeActual, brokerLegs: x.detail.brokerLegs })) };
  const reconciliation = reconcilePositions(next, snapshot, checkedAtIso);
  if (reconciliation.status !== "matched") throw new Error("recovery plan does not reconcile with broker holdings");
  // Keep lastRunIso/engineSnapshotIso unchanged: preparing a plan is not a run.
  next.recovery = { preparedAtIso: checkedAtIso, source: "confirmed-broker-orders", manualTradeId: adopted[0], manualTradeIds: adopted, manage: "spread-exits-only" };
  return { ledger: next, reconciliation, manualTradeId: adopted[0], manualTradeIds: adopted };
}

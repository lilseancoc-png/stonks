// Webull v3 groups a vertical's quantity at the parent and omits leg direction.
// Bind those groups only to confirmed broker order legs, never engine guesses,
// leg ordering, cost bases, marks, or an absolute-quantity comparison alone.
const num = v => v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);
export const brokerLegKey = l => `${l.symbol}|${l.option_expire_date}|${l.option_type}|${num(l.strike_price ?? l.option_exercise_price)}`;
const fail = message => Object.assign(new Error(message), { code: "POSITION_GROUP_UNVERIFIED" });

export function confirmedOrderLegs(order) {
  const quantity = num(order?.total_quantity ?? order?.quantity);
  if (!Number.isInteger(quantity) || quantity < 1 || !Array.isArray(order?.legs) || !order.legs.length) return null;
  const legs = order.legs.map(l => ({ ...l, quantity: num(l.quantity) }));
  if (legs.some(l => !["BUY", "SELL"].includes(l.side) || l.quantity !== quantity || !l.symbol ||
      !/^\d{4}-\d{2}-\d{2}$/.test(l.option_expire_date) || !["CALL", "PUT"].includes(l.option_type) ||
      !(num(l.strike_price) > 0) || num(l.option_contract_multiplier ?? 100) !== 100 ||
      num(l.option_contract_deliverable ?? 100) !== 100)) return null;
  if (new Set(legs.map(brokerLegKey)).size !== legs.length) return null;
  return legs.map(l => ({ ...l, quantity: 1 }));
}

export function bindPositionGroup(row, brokerLegs, orderId) {
  if (!row?.position_id || !orderId || !brokerLegs?.length || row.legs?.length !== brokerLegs.length ||
      !["SINGLE", "VERTICAL"].includes(row.option_strategy) ||
      (row.option_strategy === "SINGLE" ? row.legs.length !== 1 : row.legs.length !== 2)) throw fail("unsupported broker position group");
  const legs = row.legs.map(l => {
    const proof = brokerLegs.filter(p => brokerLegKey(p) === brokerLegKey(l));
    if (!l.leg_id || proof.length !== 1) throw fail("broker group does not uniquely match confirmed order legs");
    return { legId: l.leg_id, key: brokerLegKey(l), side: proof[0].side };
  });
  return { positionId: row.position_id, orderId, legs };
}

export function resolveGroupLegs(row, binding) {
  if (!binding || binding.positionId !== row.position_id || !binding.orderId || binding.legs?.length !== row.legs?.length) throw fail("broker group direction needs confirmed order evidence");
  const qty = num(row.quantity);
  if (!Number.isInteger(qty) || qty < 0) throw fail("unsupported grouped position quantity");
  return row.legs.map(l => {
    const proofs = binding.legs.filter(p => p.legId === l.leg_id && p.key === brokerLegKey(l));
    if (proofs.length !== 1 || !["BUY", "SELL"].includes(proofs[0].side) || l.quantity != null && num(l.quantity) !== qty) throw fail("broker group legs changed; review direction and ratios");
    const reported = String(l.side || l.position_side || "").toUpperCase();
    if (reported && ![proofs[0].side, proofs[0].side === "BUY" ? "LONG" : "SHORT"].includes(reported)) throw fail("broker group direction conflicts with confirmed order evidence");
    return { ...l, quantity: qty, side: proofs[0].side };
  });
}

export function positionBindings(ledger) {
  return [...Object.values(ledger.trades || {}).map(t => t.brokerPosition), ...Object.values(ledger.positionBaseline?.groups || {}).map(g => g.binding)].filter(Boolean);
}

export function bindNewFilledGroups(ledger, response) {
  const body = response?.data ?? response, rows = Array.isArray(body) ? body : body?.positions;
  if (!Array.isArray(rows)) return;
  const bound = new Set(positionBindings(ledger).map(g => g.positionId));
  const candidates = Object.values(ledger.trades || {}).filter(t => t.openQty > 0 && !t.brokerPosition && !t.needsReview);
  for (const t of candidates) {
    const proof = (t.entryAttempts || []).find(a => a.filledQty > 0 && a.brokerLegs?.length && !a.lookupFailed);
    if (!proof) continue;
    const matches = rows.filter(r => !bound.has(r.position_id) && num(r.quantity) === t.openQty && r.legs?.length === proof.brokerLegs.length && r.legs.every(l => proof.brokerLegs.some(p => brokerLegKey(p) === brokerLegKey(l))));
    const peers = candidates.filter(other => other !== t && other.legs?.length === t.legs?.length && other.legs.every(l => t.legs.some(x => x.expiry === l.expiry && x.type === l.type && x.strike === l.strike)) && other.symbol === t.symbol);
    if (matches.length === 1 && !peers.length) {
      t.brokerPosition = bindPositionGroup(matches[0], proof.brokerLegs, proof.clientOrderId);
      bound.add(t.brokerPosition.positionId);
    }
  }
}

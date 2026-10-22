// Broker snapshots are parsed at the boundary; unknown shapes never mean flat.
export const contractKey = (symbol, leg) => `${symbol}|${leg.expiry}|${leg.type}|${Number(leg.strike)}`;
const number = (v) => v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);
function occ(symbol) {
  const m = String(symbol || "").replace(/\s/g, "").match(/^([A-Z.]+)(\d{6})([CP])(\d{8})$/);
  return m && { symbol: m[1], expiry: `20${m[2].slice(0, 2)}-${m[2].slice(2, 4)}-${m[2].slice(4)}`, type: m[3] === "C" ? "CALL" : "PUT", strike: Number(m[4]) / 1000 };
}
export function parsePositions(response) {
  const body = response?.data ?? response;
  const rows = Array.isArray(body) ? body : body?.positions;
  if (!Array.isArray(rows) || response?.pagination_key || body?.pagination_key) throw new Error("incomplete broker positions snapshot");
  const options = {}, equities = {}, unsigned = {};
  for (const row of rows) {
    const instrument = String(row.instrument_type || "").toUpperCase();
    if (instrument === "EQUITY" || instrument === "STOCK") {
      let qty = number(row.quantity);
      if (qty == null || !row.symbol) throw new Error("invalid equity position");
      if (["SHORT", "SELL"].includes(String(row.position_side || row.side || "").toUpperCase())) qty = -Math.abs(qty);
      equities[row.symbol] = (equities[row.symbol] || 0) + qty;
      continue;
    }
    if (instrument !== "OPTION") throw new Error("unsupported broker position type");
    const legs = row.legs?.length ? row.legs : [row];
    for (const leg of legs) {
      const parsed = occ(leg.symbol) || occ(row.symbol);
      const symbol = parsed?.symbol || leg.underlying_symbol || row.underlying_symbol || row.symbol;
      const descriptor = { expiry: leg.option_expire_date || parsed?.expiry, type: leg.option_type || parsed?.type,
        strike: number(leg.option_exercise_price ?? leg.strike_price ?? parsed?.strike) };
      let qty = number(leg.quantity ?? (legs.length === 1 ? row.quantity : null));
      if (qty == null || !Number.isInteger(qty) || !symbol || !descriptor.expiry || !["CALL", "PUT"].includes(descriptor.type) || descriptor.strike == null) throw new Error("invalid option position");
      if (number(leg.option_contract_multiplier ?? 100) !== 100 || number(leg.option_contract_deliverable ?? 100) !== 100) throw new Error("adjusted option needs manual review");
      const side = String(leg.side || leg.position_side || row.position_side || "").toUpperCase();
      if (["SHORT", "SELL"].includes(side)) qty = -Math.abs(qty);
      if (["LONG", "BUY"].includes(side)) qty = Math.abs(qty);
      const key = contractKey(symbol, descriptor);
      options[key] = (options[key] || 0) + qty;
      // Positive unsigned quantities cannot prove a short wing's direction.
      if (qty > 0 && !side) unsigned[key] = true;
    }
  }
  return { options, equities, unsigned };
}

export function reconcilePositions(ledger, snapshot, nowIso) {
  const expected = {}, symbols = new Set(), keys = new Set(), alerts = [], blocked = new Set();
  const active = Object.values(ledger.trades || {}).filter((t) => t.legs?.length && t.state !== "skipped" && t.state !== "missed");
  for (const t of active) {
    symbols.add(t.symbol);
    for (const leg of t.legs) {
      const key = contractKey(t.symbol, leg); keys.add(key);
      expected[key] = (expected[key] || 0) + (leg.side === "BUY" ? 1 : -1) * (t.openQty || 0);
    }
  }
  const baseline = ledger.positionBaseline;
  // Existing ledgers can only be adopted when every owned contract agrees.
  // Preserve unrelated holdings; never classify those as ours to liquidate.
  if (!baseline) {
    for (const key of keys) if ((snapshot.options[key] || 0) !== (expected[key] || 0)) alerts.push("Initial broker holdings differ from the mirror; review before enabling entries.");
    if (!alerts.length) ledger.positionBaseline = { capturedAtIso: nowIso, options: Object.fromEntries(Object.entries(snapshot.options).map(([k, v]) => [k, v - (expected[k] || 0)])), equities: snapshot.equities };
  }
  const base = ledger.positionBaseline;
  if (base) {
    for (const symbol of symbols) {
      if ((snapshot.equities[symbol] || 0) !== (base.equities[symbol] || 0)) alerts.push(`${symbol}: stock holdings changed; possible exercise, assignment, or manual trade. Review in Webull.`);
    }
    for (const key of keys) {
      if ((snapshot.options[key] || 0) !== (base.options[key] || 0) + (expected[key] || 0)) {
        alerts.push(`${key.split("|")[0]}: broker option holdings differ from confirmed fills; review missing or unbalanced legs.`);
        for (const t of active) if (t.legs.some((l) => contractKey(t.symbol, l) === key)) blocked.add(t.tradeId);
      }
      // Mixing unrelated positions in the same contract makes ownership ambiguous.
      if (base.options[key]) {
        alerts.push(`${key.split("|")[0]}: this contract overlaps a pre-existing holding; entries paused.`);
        for (const t of active) if (t.legs.some((l) => contractKey(t.symbol, l) === key)) blocked.add(t.tradeId);
      }
      if ((expected[key] || 0) < 0 && snapshot.unsigned[key]) alerts.push(`${key.split("|")[0]}: broker has not identified the short leg's direction; review required.`);
    }
  }
  if (!base) for (const t of active) blocked.add(t.tradeId);
  if (alerts.some((s) => /stock holdings|short leg/.test(s))) for (const t of active) blocked.add(t.tradeId);
  return { checkedAtIso: nowIso, status: alerts.length ? "attention" : "matched", alerts: [...new Set(alerts)], blockedTradeIds: [...blocked] };
}

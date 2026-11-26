// Market-risk stamp (2026-11-26, log only): the Bottom tracker's verdict and
// the Quant labs market-fall / "low holds" odds frozen on each new trade, so a
// later study can ask whether trades opened in a given market-risk read did
// better or worse. Engines: `marketRisk` on the record row (runEngines, after
// the book step). Top Picks: `risk` inside entrySnapshot (lib/trade-snapshot.mjs).
//
// Nothing reads it into a pick, a grade, a gate, a size or an engine rule.
// Revisit a hold or gate only after 30+ tagged closes. Keys are short on
// purpose (the entry snapshot stays under 1 KB). A missing input is left out.
// Pure, no network, no AI.

export const MARKET_RISK_STAMP_VERSION = 1;
// The odds come from the prior quant-labs.json (it is written after the
// engines run); a card older than this is not stamped.
export const MARKET_RISK_ODDS_MAX_DAYS = 10;

const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const r3 = (v) => Math.round(v * 1000) / 1000;
const ODDS_KEYS = { fall10_3m: "f10_3", fall10_6m: "f10_6", fall10_12m: "f10_12", fall20_12m: "f20_12", lowIn_6m: "low6", newHigh_12m: "hi12" };

function daysBetween(a, b) {
  const x = Date.parse(String(a || "").slice(0, 10) + "T12:00:00Z"), y = Date.parse(String(b || "").slice(0, 10) + "T12:00:00Z");
  return Number.isFinite(x) && Number.isFinite(y) ? Math.round((y - x) / 86400000) : null;
}

// bottom: { verdict, asOf } (this build's Bottom tracker). quantCard: the
// quant-labs.json `card`. today: ET date of the build.
export function marketRiskStamp({ bottom = null, quantCard = null, today = null } = {}) {
  const out = {};
  if (bottom?.verdict && bottom.verdict !== "unavailable") out.bt = String(bottom.verdict);
  const age = quantCard?.asOf && today ? daysBetween(quantCard.asOf, today) : null;
  if (quantCard && !quantCard.stale && age != null && age >= 0 && age <= MARKET_RISK_ODDS_MAX_DAYS) {
    for (const row of [...(quantCard.fall || []), ...(quantCard.recovery || [])]) {
      const k = ODDS_KEYS[row?.id], p = num(row?.p);
      if (k && p != null && p >= 0 && p <= 1) out[k] = r3(p);
    }
    if (Object.keys(out).some((k) => k !== "bt")) {
      out.oa = String(quantCard.asOf).slice(0, 10);
      if (quantCard.inDecline != null) out.dec = quantCard.inDecline ? 1 : 0;
    }
  }
  return Object.keys(out).length ? { v: MARKET_RISK_STAMP_VERSION, ...out } : null;
}

// Counts for the engines page: trades carrying the stamp, how many closed,
// and when the 30-close read is due. No win rates yet (log only).
export function marketRiskTagCounts(record, readAt = 30) {
  const all = [...(record?.open || []), ...(record?.closed || [])].filter((t) => t?.marketRisk);
  const closed = all.filter((t) => t.exitDate && t.outcome !== "void");
  const byVerdict = {};
  for (const t of all) { const k = t.marketRisk.bt || "none"; byVerdict[k] = (byVerdict[k] || 0) + 1; }
  return { tagged: all.length, closed: closed.length, readAt, ready: closed.length >= readAt, byVerdict };
}
